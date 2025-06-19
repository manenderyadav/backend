const express = require("express");
const http = require("http");
const cors = require("cors");
const dotenv = require("dotenv");
const socketIo = require("socket.io");
const connectDB = require("./config/db");

dotenv.config(); // Load environment variables from .env file
connectDB(); // Connect to MongoDB

const app = express();
const server = http.createServer(app);

// Initialize Socket.IO with CORS enabled for all origins
const io = socketIo(server, {
  cors: { origin: "*" },
});

app.use(cors()); // Enable CORS for Express routes
app.use(express.json()); // Enable JSON body parsing for Express

// Mount authentication routes
app.use("/api/auth", require("./routes/auth"));

// ===========================================
// Socket.IO Logic for Chat and Active Users
// ===========================================

// A Map to store active users: key is socket.id, value is username
const activeUsers = new Map();

// Function to broadcast the current list of active users to all clients
const broadcastActiveUsers = () => {
  // Get unique usernames from the activeUsers Map's values
  const users = Array.from(new Set(Array.from(activeUsers.values())));
  io.emit("activeUsersList", users); // Emit the list to all connected clients
};

io.on("connection", (socket) => {
  console.log(`A user connected: ${socket.id}`);

  // When a client explicitly sends their username (after login or guest login)
  socket.on("userConnected", (username) => {
    activeUsers.set(socket.id, username); // Associate socket.id with username
    console.log(`User ${username} (${socket.id}) joined.`);
    broadcastActiveUsers(); // Broadcast updated list
  });

  // When a client sends a chat message
  socket.on("chatMessage", ({ sender, message }) => {
    console.log(`Message from ${sender}: ${message}`);
    io.emit("chatMessage", { sender, message }); // Broadcast message to all clients
  });

  // When a client explicitly signals disconnection (e.g., logout button)
  socket.on("userDisconnected", (username) => {
    // If the socket ID was associated with a username, remove it
    if (activeUsers.has(socket.id)) {
      console.log(`User ${username} (${socket.id}) disconnected gracefully.`);
      activeUsers.delete(socket.id);
      broadcastActiveUsers(); // Broadcast updated list
    }
  });

  // When a client disconnects unexpectedly or closes the browser
  socket.on("disconnect", () => {
    if (activeUsers.has(socket.id)) {
      const username = activeUsers.get(socket.id);
      console.log(`User ${username} (${socket.id}) disconnected.`);
      activeUsers.delete(socket.id); // Remove user from active list
      broadcastActiveUsers(); // Broadcast updated list
    } else {
      console.log(`A user (unknown) disconnected: ${socket.id}`);
    }
  });

  // Send the current list of active users to the newly connected client
  // This ensures new clients immediately see who's online
  broadcastActiveUsers();
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
