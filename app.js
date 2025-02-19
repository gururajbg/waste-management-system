const express = require('express');
const app = express();
const mongoRoutes = require('./routes/mongo_routes');

// Add MongoDB routes
app.use(mongoRoutes);

// ... rest of your app code ... 