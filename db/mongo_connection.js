const mongoose = require('mongoose');

// MongoDB connection
mongoose.connect('mongodb://localhost:27017/waste_management', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', () => {
  console.log('Connected to MongoDB');
});

// Define schemas
const chatInteractionSchema = new mongoose.Schema({
  userId: String,
  timestamp: { type: Date, default: Date.now },
  userMessage: String,
  botResponse: String,
  sentiment: String,
  tags: [String]
});

const userFeedbackSchema = new mongoose.Schema({
  userId: String,
  timestamp: { type: Date, default: Date.now },
  rating: Number,
  feedbackText: String,
  category: String,
  tags: [String],
  sentiment: String
});

// Create models
const ChatInteraction = mongoose.model('ChatInteraction', chatInteractionSchema);
const UserFeedback = mongoose.model('UserFeedback', userFeedbackSchema);

module.exports = {
  ChatInteraction,
  UserFeedback
}; 