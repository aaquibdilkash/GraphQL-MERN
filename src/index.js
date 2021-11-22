const { ApolloServer, gql } = require("apollo-server");
const { MongoClient, ObjectId } = require("mongodb");
const dotenv = require("dotenv");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

dotenv.config();

const { DB_URI, DB_NAME, JWT_SECRET } = process.env;

const getToken = (user) =>
  jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "30d" });

const getUserFromToken = async (token, db) => {
  if (!token) return null;

  const tokenData = jwt.verify(token, JWT_SECRET);

  if (tokenData && !tokenData.id) {
    return null;
  }

  const user = await db
    .collection("Users")
    .findOne({ _id: ObjectId(tokenData.id) });
  return user;
};

const typeDefs = gql`
  type Query {
    myTaskList: [TaskList]
    getTaskList(id: ID!): TaskList
  }

  type Mutation {
    signUp(input: SignUpInput!): AuthUser!
    signIn(input: SignInInput!): AuthUser!

    createTaskList(title: String!): TaskList!
    updateTaskList(id: ID!, title: String!): TaskList!
    deleteTaskList(id: ID!): Boolean
    addUserToTaskList(taskListId: ID!, userId: ID!): TaskList!

    createToDo(content: String!, taskListId: ID!): ToDo!
    updateToDo(id: ID!, content: String, isCompleted: Boolean): ToDo!
    deleteToDo(id: ID!): Boolean!
  }

  input SignUpInput {
    email: String!
    password: String!
    name: String!
    avatar: String
  }

  input SignInInput {
    email: String!
    password: String!
  }

  type AuthUser {
    user: User!
    token: String!
  }

  type User {
    id: ID!
    name: String!
    email: String!
    avatar: String
  }

  type TaskList {
    id: ID!
    createdAt: String!
    title: String!
    progress: Float!
    users: [User!]!
    todos: [ToDo!]
  }

  type ToDo {
    id: ID!
    content: String!
    isCompleted: Boolean!
    taskList: TaskList!
  }
`;

const resolvers = {
  Query: {
    myTaskList: async (root, data, context) => {
      const { db, user } = context;
      const taskLists = await db
        .collection("TaskList")
        .find({ userIds: user._id })
        .toArray();

      return taskLists;
    },

    getTaskList: async (root, data, context) => {
      const { id } = data;
      const { db } = context;

      result = db.collection("TaskList").findOne({ _id: ObjectId(id) });
      return result;
    },
  },
  Mutation: {
    signUp: async (root, data, context) => {
      const { input } = data;
      const { db } = context;
      const hashedPassword = bcrypt.hashSync(input.password);
      const newUser = {
        ...input,
        password: hashedPassword,
      };

      // save to database
      await db.collection("Users").insertOne(newUser);

      return {
        user: newUser,
        token: getToken(newUser),
      };
    },

    signIn: async (root, data, context) => {
      const { input } = data;
      const { db } = context;

      const user = await db.collection("Users").findOne({ email: input.email });
      if (!user) {
        throw new Error("Invalid Credential");
      }

      // check if password is correct
      const isPasswordCorrect = bcrypt.compareSync(
        input.password,
        user.password
      );
      if (!isPasswordCorrect) {
        throw new Error("Invalid Credential");
      }

      return {
        user,
        token: getToken(user),
      };
    },

    createTaskList: async (root, data, context) => {
      const { title } = data;
      const { db, user } = context;

      if (!user) {
        throw new Error("Authentication Error! Please sign in");
      }

      const newTaskList = {
        title,
        createdAt: new Date().toISOString(),
        userIds: [user._id],
      };

      const result = await db.collection("TaskList").insertOne(newTaskList);
      return newTaskList;
    },

    updateTaskList: async (root, data, context) => {
      const { id, title } = data;
      const { db, user } = context;

      if (!user) {
        throw new Error("Authentication Error! Please sign in");
      }

      await db.collection("TaskList").updateOne(
        {
          _id: ObjectId(id),
        },
        {
          $set: {
            title,
          },
        }
      );

      result = db.collection("TaskList").findOne({ _id: ObjectId(id) });
      return result;
    },

    deleteTaskList: async (root, data, context) => {
      const { id } = data;
      const { user, db } = context;

      // TODO only collaborators can delete
      await db.collection("TaskList").deleteOne({ _id: ObjectId(id) });

      return true;
    },

    addUserToTaskList: async (root, data, context) => {
      const { taskListId, userId } = data;
      const { db, user } = context;

      if (!user) {
        throw new Error("Authentication Error! Please sign in");
      }

      const taskList = await db
        .collection("TaskList")
        .findOne({ _id: ObjectId(taskListId) });
      if (!taskList) {
        return null;
      }

      if (
        taskList.userIds.find((dbId) => dbId.toString() === userId.toString())
      ) {
        return taskList;
      }
      await db.collection("TaskList").updateOne(
        {
          _id: ObjectId(taskListId),
        },
        {
          $push: {
            userIDs: ObjectId(userId),
          },
        }
      );

      db.collection("TaskList").findOne({ _id: ObjectId(taskListId) });
      taskList.userIds.push(ObjectId(userId));
      return taskList;
    },

    // Todo Items
    createToDo: async (root, data, context) => {
      const { content, taskListId } = data;
      const { db, user } = context;

      if (!user) {
        throw new Error("Authentication Error! Please sign in");
      }

      const newToDo = {
        content,
        taskListId: ObjectId(taskListId),
        isCompleted: false,
      };

      await db.collection("ToDo").insertOne(newToDo);
      return newToDo;
    },

    updateToDo: async (root, data, context) => {
      const { db, user } = context;

      if (!user) {
        throw new Error("Authentication Error! Please sign in");
      }

      await db.collection("ToDo").updateOne(
        {
          _id: ObjectId(data.id),
        },
        {
          $set: data,
        }
      );

      result = db.collection("ToDo").findOne({ _id: ObjectId(data.id) });
      return result;
    },

    deleteToDo: async (root, data, context) => {
      const { id } = data;
      const { user, db } = context;

      // TODO only collaborators can delete
      await db.collection("ToDo").deleteOne({ _id: ObjectId(id) });

      return true;
    },
  },

  User: {
    id: (root) => root._id || root.id,
  },

  TaskList: {
    id: (root) => root._id || root.id,
    progress: async ({_id}, _, {db}) => {
        const todos = await db.collection("ToDo").find({taskListId: ObjectId(_id)}).toArray()
        const completed = todos.filter(todo => todo.isCompleted)

        if (todos.length === 0) {
            return 0
        }

        return 100 * (completed.length / todos.length)
    },
    users: async (root, data, context) => {
      const { userIds } = root;
      const { db } = context;
      return Promise.all(
        userIds.map((userId) =>
          db.collection("Users").findOne({ _id: ObjectId(userId) })
        )
      );
    },
    todos: async ({ _id }, _, { db }) => {
      return await db
        .collection("ToDo")
        .find({ taskListId: ObjectId(_id) })
        .toArray();
    },
  },

  ToDo: {
    id: (root) => root._id || root.id,
    taskList: async (root, data, context) => {
      const { taskListId } = root;
      const { db } = context;
      return await db
        .collection("TaskList")
        .findOne({ _id: ObjectId(taskListId) });
    },
  },
};

const start = async () => {
  const client = new MongoClient(DB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  await client.connect();
  const db = client.db(DB_NAME);

  const server = new ApolloServer({
    typeDefs,
    resolvers,
    context: async ({ req }) => {
      const user = await getUserFromToken(req.headers.authorization, db);
      return {
        db,
        user,
      };
    },
  });

  server.listen().then(({ url }) => {
    console.log(`🚀  Server ready at ${url}`);
  });
};

start();
