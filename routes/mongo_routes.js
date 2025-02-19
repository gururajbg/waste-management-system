const express = require('express');
const router = express.Router();
const natural = require('natural');
const Sentiment = require('sentiment');
const { ChatInteraction, UserFeedback } = require('../db/mongo_connection');

const sentiment = new Sentiment();
const tokenizer = new natural.WordTokenizer();

// Store chat interaction
router.post('/api/store-chat', async (req, res) => {
    try {
        const { userMessage, botResponse } = req.body;
        const userId = req.session.userId; // Assuming you're using sessions

        // Perform sentiment analysis
        const sentimentResult = sentiment.analyze(userMessage);
        const sentimentScore = sentimentResult.score;
        let sentimentLabel = 'neutral';
        if (sentimentScore > 0) sentimentLabel = 'positive';
        if (sentimentScore < 0) sentimentLabel = 'negative';

        // Extract tags using natural
        const tokens = tokenizer.tokenize(userMessage.toLowerCase());
        const tags = tokens.filter(token => token.length > 3); // Basic filtering

        const chatInteraction = new ChatInteraction({
            userId,
            userMessage,
            botResponse,
            sentiment: sentimentLabel,
            tags
        });

        await chatInteraction.save();
        res.status(200).json({ message: 'Chat interaction stored successfully' });
    } catch (error) {
        console.error('Error storing chat:', error);
        res.status(500).json({ error: 'Failed to store chat interaction' });
    }
});

// Submit feedback
router.post('/api/submit-feedback', async (req, res) => {
    try {
        const { category, rating, feedbackText } = req.body;
        const userId = req.session.userId;

        // Perform sentiment analysis
        const sentimentResult = sentiment.analyze(feedbackText);
        const sentimentLabel = sentimentResult.score > 0 ? 'positive' : 
                             sentimentResult.score < 0 ? 'negative' : 'neutral';

        // Extract tags
        const tokens = tokenizer.tokenize(feedbackText.toLowerCase());
        const tags = tokens.filter(token => token.length > 3);

        const feedback = new UserFeedback({
            userId,
            category,
            rating,
            feedbackText,
            sentiment: sentimentLabel,
            tags
        });

        await feedback.save();
        res.status(200).json({ message: 'Feedback submitted successfully' });
    } catch (error) {
        console.error('Error submitting feedback:', error);
        res.status(500).json({ error: 'Failed to submit feedback' });
    }
});

// Get feedback analytics
router.get('/api/feedback-analytics', async (req, res) => {
    try {
        const userId = req.session.userId;

        // Get average rating
        const avgRating = await UserFeedback.aggregate([
            { $match: { userId } },
            { $group: { _id: null, average: { $avg: '$rating' } } }
        ]);

        // Get total feedback count
        const totalFeedback = await UserFeedback.countDocuments({ userId });

        // Get most recent sentiment
        const recentFeedback = await UserFeedback.findOne(
            { userId },
            { sentiment: 1 },
            { sort: { timestamp: -1 } }
        );

        res.status(200).json({
            averageRating: avgRating[0]?.average || 0,
            totalFeedback,
            recentSentiment: recentFeedback?.sentiment || 'No feedback'
        });
    } catch (error) {
        console.error('Error fetching analytics:', error);
        res.status(500).json({ error: 'Failed to fetch analytics' });
    }
});

module.exports = router; 