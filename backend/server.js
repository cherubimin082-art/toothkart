const app = require('./app');
const db = require('./database');

const port = process.env.PORT || 4000;

// Vercel uses this
module.exports = app;

// Local development
if (require.main === module) {
    db.ready()
        .then(() => {
            app.listen(port, () => {
                console.log(`ToothKart running at http://localhost:${port}`);
            });
        })
        .catch(err => {
            console.error('Could not start:', err.message);
            process.exit(1);
        });
}