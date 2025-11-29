const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// CORS configuration
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Kết nối MongoDB
const MONGODB_URI = process.env.MONGODB_URI;
mongoose.connect(MONGODB_URI)
.then(() => console.log('✅ Connected to MongoDB'))
.catch(err => console.error('❌ MongoDB connection error:', err));

// Schema User
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  publicKey: String,
  createdAt: { type: Date, default: Date.now }
});

// Schema Message
const messageSchema = new mongoose.Schema({
  sender: { type: String, required: true },
  receiver: { type: String, required: true },
  encryptedMessage: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});
// Schema Friend (danh bạ)
const friendSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  friendUsername: { type: String, required: true },
  friendId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  status: { 
    type: String, 
    enum: ['pending', 'accepted', 'blocked'],
    default: 'pending'
  },
  createdAt: { type: Date, default: Date.now }
});

const Friend = mongoose.model('Friend', friendSchema);
const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);

// Store connected users
const connectedUsers = new Map();

// ==================== API ROUTES ====================

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date(),
    message: 'ChatNET Server is running!',
    database: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: '🚀 Welcome to ChatNET Backend!',
    version: '1.0.0',
    endpoints: [
      'POST /api/register - User registration',
      'POST /api/login - User login',
      'GET /api/users - Get all users',
      'GET /api/messages - Get messages between users',
      'POST /api/messages - Send message'
    ]
  });
});

// 🔐 REGISTER ENDPOINT
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, publicKey } = req.body;

    // Validate input
    if (!username || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Username and password are required' 
      });
    }

    // Check if user exists
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ 
        success: false, 
        message: 'Username already exists' 
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = new User({
      username,
      password: hashedPassword,
      publicKey: publicKey || ''
    });

    await user.save();

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      userId: user._id,
      user: { id: user._id, username: user.username }
    });

  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// 🔐 LOGIN ENDPOINT
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Validate input
    if (!username || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Username and password are required' 
      });
    }

    // Find user
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid username or password' 
      });
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid username or password' 
      });
    }

    // Generate token
    const token = jwt.sign(
      { userId: user._id, username: user.username },
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: { id: user._id, username: user.username }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// 👥 GET USERS ENDPOINT
app.get('/api/users', async (req, res) => {
  try {
    const { exclude } = req.query;
    let query = {};
    
    if (exclude) {
      query.username = { $ne: exclude };
    }
    
    const users = await User.find(query, 'username createdAt publicKey')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      users: users.map(user => ({
        id: user._id,
        username: user.username,
        publicKey: user.publicKey,
        createdAt: user.createdAt
      }))
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// 💬 GET MESSAGES BETWEEN TWO USERS
app.get('/api/messages', async (req, res) => {
  try {
    const { user1, user2 } = req.query;
    
    if (!user1 || !user2) {
      return res.status(400).json({
        success: false,
        message: 'Both users are required'
      });
    }
    
    const messages = await Message.find({
      $or: [
        { sender: user1, receiver: user2 },
        { sender: user2, receiver: user1 }
      ]
    }).sort({ timestamp: 1 });
    
    res.json({
      success: true,
      messages: messages.map(msg => ({
        _id: msg._id,
        sender: msg.sender,
        receiver: msg.receiver,
        encryptedMessage: msg.encryptedMessage,
        timestamp: msg.timestamp
      }))
    });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// 📨 SEND MESSAGE (HTTP API)
app.post('/api/messages', async (req, res) => {
  try {
    const { sender, receiver, encryptedMessage } = req.body;
    
    if (!sender || !receiver || !encryptedMessage) {
      return res.status(400).json({
        success: false,
        message: 'Sender, receiver and message are required'
      });
    }
    
    const message = new Message({
      sender,
      receiver,
      encryptedMessage,
      timestamp: new Date()
    });
    
    await message.save();

    // Notify receiver via socket if online
    const receiverSocketId = connectedUsers.get(receiver);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('new_message', {
        _id: message._id,
        sender,
        receiver,
        encryptedMessage,
        timestamp: message.timestamp
      });
    }
    
    res.json({
      success: true,
      message: 'Message sent successfully',
      messageId: message._id
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});
// ==================== FRIEND SYSTEM APIs ====================

// 👥 ADD FRIEND
app.post('/api/friends/add', async (req, res) => {
  try {
    const { userId, friendUsername } = req.body;

    if (!userId || !friendUsername) {
      return res.status(400).json({
        success: false,
        message: 'User ID and friend username are required'
      });
    }

    // Cannot add yourself
    if (userId === friendUsername) {
      return res.status(400).json({
        success: false,
        message: 'Cannot add yourself as friend'
      });
    }

    // Check if user exists
    const friendUser = await User.findOne({ username: friendUsername });
    if (!friendUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if already friends
    const existingFriend = await Friend.findOne({ 
      userId, 
      friendUsername 
    });
    
    if (existingFriend) {
      return res.status(400).json({
        success: false,
        message: existingFriend.status === 'pending' 
          ? 'Friend request already sent' 
          : 'Already friends'
      });
    }

    // Create friend request
    const friend = new Friend({
      userId,
      friendUsername,
      friendId: friendUser._id,
      status: 'pending'
    });

    await friend.save();

    res.json({
      success: true,
      message: 'Friend request sent successfully',
      friendRequest: friend
    });

  } catch (error) {
    console.error('Add friend error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// 👥 ACCEPT FRIEND REQUEST
app.post('/api/friends/accept', async (req, res) => {
  try {
    const { userId, friendUsername } = req.body;

    const friendRequest = await Friend.findOneAndUpdate(
      { 
        friendUsername: userId, // Current user is the receiver
        userId: friendUsername, // The one who sent request
        status: 'pending'
      },
      { status: 'accepted' },
      { new: true }
    );

    if (!friendRequest) {
      return res.status(404).json({
        success: false,
        message: 'Friend request not found'
      });
    }

    res.json({
      success: true,
      message: 'Friend request accepted',
      friend: friendRequest
    });

  } catch (error) {
    console.error('Accept friend error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// 👥 GET FRIENDS LIST
app.get('/api/friends/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const friends = await Friend.find({ 
      userId, 
      status: 'accepted' 
    }).populate('friendId', 'username createdAt');

    res.json({
      success: true,
      friends: friends.map(friend => ({
        id: friend.friendId._id,
        username: friend.friendUsername,
        createdAt: friend.createdAt
      }))
    });

  } catch (error) {
    console.error('Get friends error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// 👥 GET PENDING REQUESTS
app.get('/api/friends/pending/:username', async (req, res) => {
  try {
    const { username } = req.params;

    const pendingRequests = await Friend.find({ 
      friendUsername: username,
      status: 'pending' 
    }).populate('userId', 'username');

    res.json({
      success: true,
      pendingRequests: pendingRequests.map(request => ({
        id: request._id,
        fromUser: request.userId.username,
        createdAt: request.createdAt
      }))
    });

  } catch (error) {
    console.error('Get pending requests error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});
// ==================== SOCKET.IO HANDLERS ====================

io.on('connection', (socket) => {
  console.log('🔗 User connected:', socket.id);

  // User joins their personal room
  socket.on('join', (username) => {
    socket.join(username);
    connectedUsers.set(username, socket.id);
    console.log(`👤 User ${username} joined room`);
    
    // Broadcast to others that this user is online
    socket.broadcast.emit('user_online', username);
  });

  // Handle sending messages via socket
  socket.on('send_message', async (data) => {
    try {
      const { sender, receiver, encryptedMessage } = data;
      
      console.log(`📨 Message from ${sender} to ${receiver}`);
      
      // Save to database
      const message = new Message({
        sender,
        receiver,
        encryptedMessage,
        timestamp: new Date()
      });
      
      await message.save();
      
      // Send to receiver if online
      const receiverSocketId = connectedUsers.get(receiver);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('new_message', {
          _id: message._id,
          sender,
          receiver,
          encryptedMessage,
          timestamp: message.timestamp
        });
      }
      
      // Send confirmation to sender
      socket.emit('message_sent', { success: true, messageId: message._id });
      
    } catch (error) {
      console.error('Error sending message:', error);
      socket.emit('message_sent', { success: false, error: error.message });
    }
  });

  // Handle user typing
  socket.on('typing', (data) => {
    const receiverSocketId = connectedUsers.get(data.receiver);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('user_typing', {
        sender: data.sender,
        isTyping: data.isTyping
      });
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('🔴 User disconnected:', socket.id);
    
    // Remove from connected users
    for (let [username, socketId] of connectedUsers.entries()) {
      if (socketId === socket.id) {
        connectedUsers.delete(username);
        // Broadcast that user went offline
        io.emit('user_offline', username);
        console.log(`👤 User ${username} went offline`);
        break;
      }
    }
  });
});

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔐 API endpoints:`);
  console.log(`   POST /api/register - User registration`);
  console.log(`   POST /api/login - User login`);
  console.log(`   GET /api/users - Get all users`);
  console.log(`   GET /api/messages - Get messages between users`);
  console.log(`   POST /api/messages - Send message`);
  console.log(`🔌 Socket.io events: join, send_message, typing`);
});
