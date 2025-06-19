const express = require("express");
const http = require("http");
const cors = require("cors");
const dotenv = require("dotenv");
const socketIo = require("socket.io");
const connectDB = require("./config/db"); // Your existing MongoDB connection
require('dotenv').config();
// Import Firebase Admin SDK
const admin = require("firebase-admin");

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
// Initialize Firebase Admin SDK for Firestore
// ===========================================
// Ensure FIREBASE_SERVICE_ACCOUNT_KEY is set as an environment variable
// on Render with the content of your Firebase service account JSON file.
try {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log("Firebase Admin SDK initialized successfully.");
} catch (error) {
  console.error("Failed to initialize Firebase Admin SDK:", error);
  // It's critical that Firebase initializes; if it fails, the app won't function.
  // In a production app, you might want a more robust error handling/exit strategy.
}

const db = admin.firestore(); // Get a reference to the Firestore database
const chatMessagesRef = db.collection('chatMessages'); // Reference to your chat messages collection

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

io.on("connection", async (socket) => {
  console.log(`A user connected: ${socket.id}`);

  // When a client explicitly sends their username (after login or guest login)
  socket.on("userConnected", (username) => {
    activeUsers.set(socket.id, username); // Associate socket.id with username
    console.log(`User ${username} (${socket.id}) joined.`);
    broadcastActiveUsers(); // Broadcast updated list
  });

  // When a client sends a chat message
  socket.on("chatMessage", async ({ sender, message }) => {
    console.log(`Message from ${sender}: ${message}`);
    // Save message to Firestore
    try {
      const newMessage = {
        sender: sender,
        message: message,
        timestamp: admin.firestore.FieldValue.serverTimestamp() // Firestore timestamp
      };
      await chatMessagesRef.add(newMessage);
      console.log("Message saved to Firestore.");
      io.emit("chatMessage", { sender, message }); // Broadcast message to all clients
    } catch (error) {
      console.error("Error saving message to Firestore:", error);
    }
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

  // ===========================================
  // Fetch and send historical messages to new client
  // ===========================================
  try {
    const snapshot = await chatMessagesRef
      .orderBy('timestamp', 'desc') // Order by timestamp in descending order
      .limit(20) // Limit to the last 20 messages
      .get();

    const historicalMessages = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      historicalMessages.push({
        sender: data.sender,
        message: data.message,
        // Frontend will sort by timestamp if needed, but for display order, just push
        // You might want to format timestamp here or on frontend if displaying it
      });
    });

    // Reverse the array to get messages in chronological order (oldest first)
    historicalMessages.reverse();

    // Emit historical messages to the specific client that just connected
    socket.emit('historicalMessages', historicalMessages);
    console.log(`Sent ${historicalMessages.length} historical messages to ${socket.id}`);

  } catch (error) {
    console.error("Error fetching historical messages from Firestore:", error);
  }

  // Send the current list of active users to the newly connected client
  // This ensures new clients immediately see who's online
  broadcastActiveUsers();
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
