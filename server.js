const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const bcrypt = require('bcrypt'); // For password hashing
const path = require('path'); // Import path module


const mongoose = require('mongoose');
const natural = require('natural');
const Sentiment = require('sentiment');
const { ChatInteraction, UserFeedback } = require('./db/mongo_connection');

const app = express();
const port = 3000;

// Add this near the top of server.js
process.on('unhandledRejection', (error) => {
  console.error('Unhandled Promise Rejection:', error);
  // Don't exit the process, just log the error
});

// Database connection
const pool = new Pool({
    user: 'postgres', // Replace with your PostgreSQL username
    host: 'localhost',
    database: 'wastemngt', // Replace with your database name
    password: '123456', // Replace with your PostgreSQL password
    port: 5432,
});

// Initialize sentiment analysis and tokenizer
const sentiment = new Sentiment();
const tokenizer = new natural.WordTokenizer();

// Update MongoDB connection with better error handling
mongoose.connect('mongodb://127.0.0.1:27017/waste_management')
  .then(() => {
    console.log('Connected to MongoDB');
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
    // Log error but don't crash the app
    // The app can still function with PostgreSQL even if MongoDB fails
  });

// Serve static files from the current directory
app.use(express.static(path.join(__dirname))); // Serve static files
app.use(bodyParser.json());

// Session middleware configuration
app.use(session({
    secret: 'your_secret_key', // Replace with a strong secret key
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Set to true if using HTTPS
}));

// Serve the index page (landing page)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html')); // Serve index.html
});

// Serve the login page
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html')); // Serve login page
});

// Serve the signup page
app.get('/signup', (req, res) => {
    res.sendFile(path.join(__dirname, 'signup.html')); // Serve signup page
});

// User registration endpoint
app.post('/api/register', async (req, res) => {
    const { u_name, email, ld, gender, age, occupation, u_mobile, address, area_id } = req.body;
    const hashedPassword = await bcrypt.hash(req.body.password, 10); // Hash the password
    try {
        const result = await pool.query(
            'INSERT INTO USERS (u_name, email, ld, gender, age, occupation, u_mobile, address, area_id, password) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *',
            [u_name, email, ld, gender, age, occupation, u_mobile, address, area_id, hashedPassword] // Default isAdmin is not included
        );
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error during registration:', error); // Log the error
        res.status(500).json({ error: 'User registration failed' });
    }
});

// User login endpoint
// User login endpoint
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM USERS WHERE email = $1', [email]);
        const user = result.rows[0];
        if (user && await bcrypt.compare(password, user.password)) {
            // Store user info in session
            req.session.user = {
                id: user.user_id,
                name: user.u_name,
                email: user.email,
                isAdmin: user.isadmin
            };
            
            if (user.isadmin) {
                res.redirect('/admin/dashboard');
            } else {
                res.redirect('/user/dashboard');
            }
        } else {
            res.status(401).json({ error: 'Invalid email or password' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Login failed' });
    }
});

// Serve user dashboard
app.get('/user/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'user_dashboard.html')); // Serve user dashboard
});

// Serve admin dashboard
app.get('/admin/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin_dashboard.html')); // Serve admin dashboard
});

// Logout endpoint (optional)
app.get('/logout', (req, res) => {
    // Handle logout logic here (e.g., destroy session, clear tokens)
    res.redirect('/login'); // Redirect to login page after logout
});

// Authentication middleware
const requireLogin = (req, res, next) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Please log in to access this resource' });
    }
    next();
};

// Fetch complaints
app.get('/api/complaints', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM COMPLAINT'); // Fetch all complaints
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching complaints:', error);
        res.status(500).json({ error: 'Failed to fetch complaints' });
    }
});
// Fetch waste tracking data for the user
app.get('/api/user-waste-data', requireLogin, async (req, res) => {
    const userId = req.session.user.id;
    // console.log(userId);
    try {
        const result = await pool.query('SELECT SUM(wp.bio_weight) AS bio_weight, SUM(wp.non_bio_weight) AS non_bio_weight FROM WASTE_PRODUCED wp JOIN USERS u1 ON wp.user_id = u1.user_id WHERE u1.area_id = (SELECT area_id FROM USERS WHERE user_id = $1 LIMIT 1) AND wp.w_date = CURRENT_DATE;', [userId]);
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error fetching user waste data:', error);
        res.status(500).json({ error: 'Failed to fetch user waste data' }); 
    }
});
app.get('/api/waste-tracking', requireLogin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                SUM(bio_weight) AS bio_weight, 
                SUM(non_bio_weight) AS non_bio_weight, 
                SUM(bio_weight + non_bio_weight) AS total_waste_produced_per_day 
            FROM 
                WASTE_PRODUCED 
            WHERE 
                w_date = CURRENT_DATE
        `);

        // Check if any data was returned
        if (result.rows.length === 0) {
            return res.json({ bio_weight: 0, non_bio_weight: 0, total_waste_produced_per_day: 0 });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error fetching waste tracking data:', error);
        res.status(500).json({ error: 'Failed to fetch waste tracking data' });
    }
});
app.get('/api/all-area-waste-data', requireLogin, async (req, res) => {
    const userId = req.session.user.id;
    try {
        const result = await pool.query(`SELECT 
            a.name AS area_name,
            SUM(wp.total_waste_produced_per_day) AS total_waste
        FROM 
            area a
        JOIN 
            waste_produced wp ON a.area_id = wp.area_id
        WHERE 
            wp.w_date = CURRENT_DATE
        GROUP BY 
            a.name;`);

        // Handle empty result
        const response = result.rows[0] || { message: "No data available for today." };
        res.setHeader('Content-Type', 'application/json');
        res.json(response);
    } catch (error) {
        console.error('Error fetching user waste data:', error);
        res.status(500).json({ error: 'Failed to fetch user waste data' });
    }
});


// Fetch collection management data for the user
app.get('/api/user-collection-data', requireLogin, async (req, res) => {
    const userId = req.session.user.id;
    try {
        const result = await pool.query('SELECT wp.w_date , SUM(wp.bio_weight) AS bio_weight, SUM(wp.non_bio_weight) AS non_bio_weight  FROM WASTE_PRODUCED wp JOIN USERS u1 ON wp.user_id = u1.user_id WHERE u1.area_id = (SELECT area_id FROM USERS WHERE user_id = $1 LIMIT 1) GROUP BY wp.w_date;', [userId]);
       
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching user collection data:', error);
        res.status(500).json({ error: 'Failed to fetch user collection data' });
    }
});

// Handle complaint submission
app.post('/api/register-complaint', requireLogin, async (req, res) => {
    const { message, image } = req.body;
    const userId = req.session.user.id;
    const complaintDate = new Date();
    const complaintTime = complaintDate.toLocaleTimeString();

    try {
        const result = await pool.query(
            'INSERT INTO COMPLAINT (message, image, complaint_date, complaint_time, user_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [message, image, complaintDate, complaintTime, userId]
        );
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error registering complaint:', error);
        res.status(500).json({ error: 'Failed to register complaint' });
    }
});

// Handle profile update
app.post('/api/update-profile', requireLogin, async (req, res) => {
    const { u_name, email } = req.body;
    const userId = req.session.user.id;
    try {
        await pool.query('UPDATE USERS SET u_name = $1, email = $2 WHERE user_id = $3', [u_name, email, userId]);
        res.status(204).send();
    } catch (error) {
        console.error('Error updating profile:', error);
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

// Endpoint to update waste collection
app.post('/api/update-collection', async (req, res) => {
    const { user_id, area_id, bio_weight, non_bio_weight } = req.body;
    const currentDate = new Date().toISOString().split('T')[0]; // Get only the date (YYYY-MM-DD format)
    const collectionTime = new Date().toTimeString().split(' ')[0]; // Get current time in HH:MM:SS format

    try {
        // Insert the new waste collection record
        await pool.query(
            'INSERT INTO WASTE_COLLECTION (c_date, area_id, c_time, vehicle_id) VALUES ($1, $2, $3, (SELECT vehicle_id FROM VEHICLE WHERE driver_name = $4 AND driver_phone = $5))',
            [currentDate, area_id, collectionTime, req.session.driverName, req.session.driverPhone]
        );

        // Calculate the total waste produced
        const totalWasteProduced = parseFloat(bio_weight) + parseFloat(non_bio_weight);
        // console.log(totalWasteProduced); // Ensure proper addition

        // Check if there's already a record for today
        const result = await pool.query(
            'SELECT * FROM WASTE_PRODUCED WHERE w_date = $1 AND user_id = $2',
            [currentDate, user_id]
        );

        if (result.rows.length > 0) {
            // Update existing record
            await pool.query(
                'UPDATE WASTE_PRODUCED SET non_bio_weight = non_bio_weight + $1, bio_weight = bio_weight + $2, total_waste_produced_per_day = total_waste_produced_per_day + $3 WHERE w_date = $4 AND user_id = $5',
                [parseFloat(non_bio_weight), parseFloat(bio_weight), totalWasteProduced, currentDate, user_id]
            );
        } else {
            // Insert new record
            await pool.query(
                'INSERT INTO WASTE_PRODUCED (w_date, user_id, non_bio_weight, bio_weight, total_waste_produced_per_day) VALUES ($1, $2, $3, $4, $5)',
                [currentDate, user_id, parseFloat(non_bio_weight), parseFloat(bio_weight), totalWasteProduced]
            );
        }

        res.status(201).json({ message: 'Waste collection updated successfully!' });
    } catch (error) {
        console.error('Error updating waste collection:', error);
        res.status(500).json({ error: 'Failed to update waste collection' });
    }
});


// const bcrypt = require('bcrypt'); // For password hashing

app.post('/api/driver-login', async (req, res) => {
    const { driver_name, driver_phone } = req.body;

    try {
        const result = await pool.query(
            'SELECT * FROM VEHICLE WHERE driver_name = $1 AND driver_phone = $2',
            [driver_name, driver_phone]
        );
        const driver = result.rows[0];

        if (driver) {
            req.session.driverName = driver_name;
            req.session.driverPhone = driver_phone;

            
            if (driver.password == 'wastemngt@123') {
                // Redirect to password update page
                console.log("hello");
                res.redirect('/driver/update-password');
            } else {
                // Redirect to dashboard
                //  console.log("hello");
                res.redirect('/driver/dashboard');
            }
        } else {
            res.status(401).json({ error: 'Invalid driver name or phone number' });
        }
    } catch (error) {
        console.error('Login failed:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// const path = require('path');

app.get('/driver/update-password', (req, res) => {
    res.sendFile(path.join(__dirname, 'update_password.html'));
});

//update drivers password
app.post('/api/update-password', async (req, res) => {
    const { new_password } = req.body;
        driver_name = req.session.driverName;
       

    try {
        // Hash the new password
        // console.log(new_password);
        // console.log(driver_name);
        // console.log(driver_phone);
        const hashedPassword = await bcrypt.hash(new_password, 10);

        // Update the driver's password
        await pool.query(
            'UPDATE VEHICLE SET password = $1 WHERE driver_name = $2',
            [hashedPassword, driver_name]
        );

        res.json({ message: 'Password updated successfully!' });
    } catch (error) {
        console.error('Error updating password:', error);
        res.status(500).json({ error: 'Failed to update password' });
    }
});

// Serve driver dashboard
app.get('/driver/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'driver_dashboard.html')); // Serve driver dashboard
});

// Add or update vehicle
app.post('/api/manage-vehicle', async (req, res) => {
    const { vehicle_id, driver_name, driver_phone, area_id } = req.body;
    try {
        if (vehicle_id) {
            // Update existing vehicle
            await pool.query('UPDATE VEHICLE SET driver_name = $1, driver_phone = $2, area_id = $3 WHERE vehicle_id = $4', [driver_name, driver_phone, area_id, vehicle_id]);
            res.status(204).send(); // No content
        } else {
            // Add new vehicle
            await pool.query('INSERT INTO VEHICLE (driver_name, driver_phone, area_id) VALUES ($1, $2, $3)', [driver_name, driver_phone, area_id]);
            res.status(201).json({ message: 'Vehicle added successfully!' });
        }
    } catch (error) {
        console.error('Error managing vehicle:', error);
        res.status(500).json({ error: 'Failed to manage vehicle' });
    }
});

// Fetch vehicles for management
app.get('/api/vehicles', requireLogin, async (req, res) => {
    try {
        const result = await pool.query('SELECT vehicle_id, driver_name, driver_phone, area_id FROM VEHICLE ORDER BY vehicle_id ASC');
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching vehicles:', error);
        res.status(500).json({ error: 'Failed to fetch vehicles' });
    }
});

// Delete vehicle
app.delete('/api/delete-vehicle/:vehicleId', async (req, res) => {
    const vehicleId = req.params.vehicleId;
    try {
        await pool.query('DELETE FROM VEHICLE WHERE vehicle_id = $1', [vehicleId]);
        res.status(204).send(); // No content
    } catch (error) {
        console.error('Error deleting vehicle:', error);
        res.status(500).json({ error: 'Failed to delete vehicle' });
    }
});

// Endpoint to get the vehicle ID for the logged-in driver
app.get('/api/get-vehicle-id', async (req, res) => {
    const driverName = req.session.driverName; // Assuming you store the driver's name in the session
    const driverPhone = req.session.driverPhone; // Assuming you store the driver's phone in the session

    try {
        const result = await pool.query('SELECT vehicle_id FROM VEHICLE WHERE driver_name = $1 AND driver_phone = $2', [driverName, driverPhone]);
        const vehicle = result.rows[0];
        if (vehicle) {
            res.json({ vehicle_id: vehicle.vehicle_id });
        } else {
            res.status(404).json({ error: 'Vehicle not found for this driver' });
        }
    } catch (error) {
        console.error('Error fetching vehicle ID:', error);
        res.status(500).json({ error: 'Failed to fetch vehicle ID' });
    }
});

// Endpoint to fetch total waste
app.get('/api/total-waste', async (req, res) => {
    const currentDate = new Date().toISOString().split('T')[0]; // Get today's date
    const vehicleId = await getVehicleIdFromSession(req); // Function to get vehicle ID from session

    try {
        const result = await pool.query(
            'SELECT SUM(bio_weight) AS total_bio_weight, SUM(non_bio_weight) AS total_non_bio_weight FROM WASTE_PRODUCED WHERE w_date = $1 AND user_id IN (SELECT user_id FROM WASTE_COLLECTION WHERE vehicle_id = $2)',
            [currentDate, vehicleId]
        );
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error fetching total waste:', error);
        res.status(500).json({ error: 'Failed to fetch total waste' });
    }
});

// Endpoint to fetch collection history
app.get('/api/collection-history', async (req, res) => {
    try {
        // Get vehicle ID from session
        const vehicleId = await getVehicleIdFromSession(req);

        // Fetch unique collection history
        const query = `
            SELECT DISTINCT 
                c.c_date, 
                c.area_id, 
                p.bio_weight, 
                p.non_bio_weight 
            FROM 
                WASTE_COLLECTION c 
            JOIN 
                WASTE_PRODUCED p 
            ON 
                c.area_id = p.area_id 
            WHERE 
                c.vehicle_id = $1 
            ORDER BY 
                c.c_date DESC;
        `;
        const result = await pool.query(query, [vehicleId]);

        // Check if the result contains data
        if (result.rows.length === 0) {
            return res.json({ message: "No collection history available for this vehicle." });
        }

        // Respond with the unique collection history
        res.json(result.rows);
    } catch (error) {
        // Log the error for debugging purposes
        console.error('Error fetching collection history:', error);

        // Respond with a 500 error status and meaningful error message
        res.status(500).json({ error: 'Failed to fetch collection history. Please try again later.' });
    }
});


// Endpoint to submit feedback
app.post('/api/submit-feedback', async (req, res) => {
    const { feedback } = req.body;
    const driverName = req.session.driverName; // Assuming you store the driver's name in the session

    try {
        // Insert feedback into the database (you may need to create a feedback table)
        await pool.query('INSERT INTO DRIVER_FEEDBACK (driver_name, feedback, feedback_date) VALUES ($1, $2, NOW())', [driverName, feedback]);
        res.status(201).json({ message: 'Feedback submitted successfully!' });
    } catch (error) {
        console.error('Error submitting feedback:', error);
        res.status(500).json({ error: 'Failed to submit feedback' });
    }
});

// Endpoint for logout
app.post('/api/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.status(500).json({ error: 'Failed to log out' });
        }
        res.status(200).json({ message: 'Logged out successfully' });
    });
});

// Fetch waste management data for the user
app.get('/api/waste-management', requireLogin, async (req, res) => {
    const userId = req.session.user.id;
    try {
        const result = await pool.query(`
            SELECT 
                wc.c_date, 
                wc.c_time, 
                wp.bio_weight, 
                wp.non_bio_weight 
            FROM 
                WASTE_COLLECTION wc
            JOIN 
                WASTE_PRODUCED wp ON wc.c_date = wp.w_date 
            ORDER BY 
                wc.c_date DESC
        `);

        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching waste management data:', error);
        res.status(500).json({ error: 'Failed to fetch waste management data' });
    }
});

// Endpoint to fetch collection management data
app.get('/api/collection-management', requireLogin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
    a.name AS area_name,
    wc.c_date AS collection_date,
    wc.c_time AS collection_time,
    v.vehicle_id,
    v.driver_name,
    v.driver_phone
FROM 
    area a
JOIN 
    waste_collection wc ON a.area_id = wc.area_id
JOIN 
    vehicle v ON wc.vehicle_id = v.vehicle_id
ORDER BY 
    a.name, wc.c_date;
        `);

        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching collection management data:', error);
        res.status(500).json({ error: 'Failed to fetch collection management data' });
    }
});

// Endpoint to fetch user management data
app.get('/api/user-management', requireLogin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                user_id, 
                u_name, 
                email 
            FROM 
                USERS
            ORDER BY 
                u_name ASC
        `);

        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching user management data:', error);
        res.status(500).json({ error: 'Failed to fetch user management data' });
    }
});

// Endpoint to delete a user
app.delete('/api/delete-user/:userId', requireLogin, async (req, res) => {
    const userId = req.params.userId; // Get the user ID from the request parameters
    try {
        const result = await pool.query('DELETE FROM USERS WHERE user_id = $1', [userId]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ message: 'User deleted successfully' });
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

// Endpoint to fetch drivers
app.get('/api/drivers', requireLogin, async (req, res) => {
    try {
        const result = await pool.query('SELECT vehicle_id, driver_name, driver_phone FROM VEHICLE ORDER BY driver_name ASC');
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching drivers:', error);
        res.status(500).json({ error: 'Failed to fetch drivers' });
    }
});

// Endpoint to fetch report data
app.get('/api/report-data', async (req, res) => {
    const { type, timeRange, area } = req.query;
    
    try {
        let data = {
            labels: [],
            details: []
        };

        switch(type) {
            case 'waste':
                data = await getWasteReport(timeRange, area);
                break;
            case 'collection':
                data = await getCollectionReport(timeRange, area);
                break;
            case 'feedback':
                data = await getFeedbackReport(timeRange);
                break;
            case 'complaints':
                data = await getComplaintReport(timeRange, area);
                break;
        }

        res.json(data);
    } catch (error) {
        console.error('Error generating report:', error);
        res.status(500).json({ error: 'Failed to generate report' });
    }
});

async function getWasteReport(timeRange, area) {
    let dateFilter = getDateFilter(timeRange);
    let areaFilter = area === 'all' ? '' : 'AND wp.area_id = $2';
    
    const query = `
        SELECT 
            w_date as date,
            SUM(bio_weight) as bio_waste,
            SUM(non_bio_weight) as non_bio_waste,
            wp.area_id,
            a.name as area_name
        FROM waste_produced wp
        JOIN area a ON wp.area_id = a.area_id
        WHERE w_date >= $1 ${areaFilter}
        GROUP BY w_date, wp.area_id, a.name
        ORDER BY w_date
    `;

    const params = area === 'all' ? [dateFilter] : [dateFilter, area];
    const result = await pool.query(query, params);

    return processWasteData(result.rows);
}

function getDateFilter(timeRange) {
    const now = new Date();
    switch(timeRange) {
        case 'day':
            return new Date(now.setHours(0,0,0,0));
        case 'week':
            return new Date(now.setDate(now.getDate() - 7));
        case 'month':
            return new Date(now.setMonth(now.getMonth() - 1));
        case 'year':
            return new Date(now.setFullYear(now.getFullYear() - 1));
        default:
            return new Date(now.setDate(now.getDate() - 30));
    }
}

function processWasteData(rows) {
    const labels = rows.map(row => row.date);
    const bioWaste = rows.map(row => row.bio_waste);
    const nonBioWaste = rows.map(row => row.non_bio_waste);
    
    return {
        labels,
        bioWaste,
        nonBioWaste,
        totalWaste: rows.reduce((acc, row) => acc + row.bio_waste + row.non_bio_waste, 0),
        averageDaily: (rows.reduce((acc, row) => acc + row.bio_waste + row.non_bio_waste, 0) / rows.length).toFixed(2),
        peakGenerationTime: findPeakTime(rows),
        details: rows
    };
}

// Start the server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});

async function getVehicleIdFromSession(req) {
    const driverName = req.session.driverName; // Assuming you store the driver's name in the session
    const driverPhone = req.session.driverPhone; // Assuming you store the driver's phone in the session

    if (!driverName || !driverPhone) {
        throw new Error('Driver not logged in');
    }

    try {
        const result = await pool.query('SELECT vehicle_id FROM VEHICLE WHERE driver_name = $1 AND driver_phone = $2', [driverName, driverPhone]);
        const vehicle = result.rows[0];
        if (vehicle) {
            return vehicle.vehicle_id; // Return the vehicle ID
        } else {
            throw new Error('Vehicle not found for this driver');
        }
    } catch (error) {
        console.error('Error fetching vehicle ID:', error);
        throw new Error('Failed to fetch vehicle ID');
    }
}

// Add these new route handlers
async function handleStoreChatInteraction(req, res) {
    try {
        const { userMessage, botResponse } = JSON.parse(req.body);
        const userId = req.session?.userId || 'anonymous';

        // Perform sentiment analysis
        const sentimentResult = sentiment.analyze(userMessage);
        const sentimentScore = sentimentResult.score;
        let sentimentLabel = 'neutral';
        if (sentimentScore > 0) sentimentLabel = 'positive';
        if (sentimentScore < 0) sentimentLabel = 'negative';

        // Extract tags
        const tokens = tokenizer.tokenize(userMessage.toLowerCase());
        const tags = tokens.filter(token => token.length > 3);

        const chatInteraction = new ChatInteraction({
            userId,
            userMessage,
            botResponse,
            sentiment: sentimentLabel,
            tags
        });

        await chatInteraction.save();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Chat interaction stored successfully' }));
    } catch (error) {
        console.error('Error storing chat:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to store chat interaction' }));
    }
}

async function handleSubmitFeedback(req, res) {
    try {
        const { category, rating, feedbackText } = JSON.parse(req.body);
        const userId = req.session?.userId || 'anonymous';

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
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Feedback submitted successfully' }));
    } catch (error) {
        console.error('Error submitting feedback:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to submit feedback' }));
    }
}

async function handleFeedbackAnalytics(req, res) {
    try {
        const userId = req.session?.userId || 'anonymous';

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

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            averageRating: avgRating[0]?.average || 0,
            totalFeedback,
            recentSentiment: recentFeedback?.sentiment || 'No feedback'
        }));
    } catch (error) {
        console.error('Error fetching analytics:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to fetch analytics' }));
    }
}

// Add these new routes before app.listen()
app.post('/api/store-chat', async (req, res) => {
    try {
        const { userMessage, botResponse } = req.body;
        const userId = req.session?.userId || 'anonymous';

        // Perform sentiment analysis
        const sentimentResult = sentiment.analyze(userMessage);
        const sentimentScore = sentimentResult.score;
        let sentimentLabel = 'neutral';
        if (sentimentScore > 0) sentimentLabel = 'positive';
        if (sentimentScore < 0) sentimentLabel = 'negative';

        // Extract tags using natural
        const tokens = tokenizer.tokenize(userMessage.toLowerCase());
        const tags = tokens.filter(token => token.length > 3);

        const chatInteraction = new ChatInteraction({
            userId,
            userMessage,
            botResponse,
            sentiment: sentimentLabel,
            tags
        });

        await chatInteraction.save();
        res.json({ message: 'Chat interaction stored successfully' });
    } catch (error) {
        console.error('Error storing chat:', error);
        res.status(500).json({ error: 'Failed to store chat interaction' });
    }
});

// MongoDB feedback submission route
app.post('/api/submit-feedback-mongo', async (req, res) => {
    try {
        const { category, rating, feedbackText } = req.body;
        const userId = req.session?.userId || 'anonymous';

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
        res.json({ message: 'Feedback submitted successfully' });
    } catch (error) {
        console.error('Error submitting feedback:', error);
        res.status(500).json({ error: 'Failed to submit feedback' });
    }
});

app.get('/api/feedback-analytics', async (req, res) => {
    try {
        const userId = req.session?.userId || 'anonymous';

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

        res.json({
            averageRating: avgRating[0]?.average || 0,
            totalFeedback,
            recentSentiment: recentFeedback?.sentiment || 'No feedback'
        });
    } catch (error) {
        console.error('Error fetching analytics:', error);
        res.status(500).json({ error: 'Failed to fetch analytics' });
    }
});

// Add this new route to fetch admin feedback data
app.get('/api/admin/feedback', async (req, res) => {
    try {
        // Get all feedback
        const feedback = await UserFeedback.find().sort({ timestamp: -1 });
        
        // Calculate analytics
        const totalFeedback = feedback.length;
        const averageRating = feedback.reduce((acc, curr) => acc + curr.rating, 0) / totalFeedback;
        
        // Calculate sentiment distribution
        const sentiments = feedback.reduce((acc, curr) => {
            acc[curr.sentiment.toLowerCase()]++;
            return acc;
        }, { positive: 0, neutral: 0, negative: 0 });
        
        const total = Object.values(sentiments).reduce((a, b) => a + b, 0);
        const sentimentDistribution = {
            positive: Math.round((sentiments.positive / total) * 100),
            neutral: Math.round((sentiments.neutral / total) * 100),
            negative: Math.round((sentiments.negative / total) * 100)
        };

        res.json({
            totalFeedback,
            averageRating,
            sentimentDistribution,
            feedback
        });
    } catch (error) {
        console.error('Error fetching admin feedback data:', error);
        res.status(500).json({ error: 'Failed to fetch feedback data' });
    }
});

// Update the search reports route
app.post('/api/search-reports', async (req, res) => {
    const { searchTerm, reportType } = req.body;
    
    try {
        let query = `
            SELECT 
                wp.w_date as date,
                a.name as area_name,
                wp.bio_weight,
                wp.non_bio_weight,
                CASE 
                    WHEN wp.bio_weight + wp.non_bio_weight > 0 THEN 'Completed'
                    ELSE 'Pending'
                END as status
            FROM waste_produced wp
            JOIN area a ON wp.area_id = a.area_id
            WHERE (LOWER(a.name) LIKE $1 
                OR CAST(wp.w_date AS TEXT) LIKE $1)
        `;

        // Modified filtering based on report type
        if (reportType === 'waste') {
            query += ` AND (wp.bio_weight > 0 OR wp.non_bio_weight > 0)`;
        } else if (reportType === 'collection') {
            query += ` AND status = 'Completed'`;
        }

        query += ` ORDER BY wp.w_date DESC`;

        const result = await pool.query(query, [`%${searchTerm}%`]);

        // Calculate summary statistics
        const totalWaste = result.rows.reduce((acc, row) => 
            acc + (Number(row.bio_weight) || 0) + (Number(row.non_bio_weight) || 0), 0);
        
        const activeAreas = new Set(result.rows.map(row => row.area_name)).size;
        
        const completedCollections = result.rows.filter(r => r.status === 'Completed').length;
        const efficiency = result.rows.length > 0 
            ? ((completedCollections / result.rows.length) * 100).toFixed(1)
            : 0;

        res.json({
            reports: result.rows,
            totalWaste,
            activeAreas,
            efficiency,
            completedCollections,
            totalCollections: result.rows.length
        });
    } catch (error) {
        console.error('Error searching reports:', error);
        res.status(500).json({ error: 'Failed to search reports' });
    }
});