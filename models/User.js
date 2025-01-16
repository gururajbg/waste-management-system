const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({
    user: 'postgres', // Replace with your PostgreSQL username
    host: 'localhost',
    database: 'wastemngt', // Replace with your database name
    password: '123456', // Replace with your PostgreSQL password
    port: 5432,
});

class User {
    static async findOne(username) {
        const res = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        return res.rows[0]; // Return the user object
    }

    static async create(username, password) {
        const hashedPassword = await bcrypt.hash(password, 10);
        const res = await pool.query('INSERT INTO users (username, password) VALUES ($1, $2) RETURNING *', [username, hashedPassword]);
        return res.rows[0]; // Return the newly created user
    }

    static async comparePassword(inputPassword, storedPassword) {
        return await bcrypt.compare(inputPassword, storedPassword);
    }
}

module.exports = User; 