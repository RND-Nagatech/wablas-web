const express = require('express');
const auth = require('../controllers/authController');
const authJwt = require('../middleware/authJwt');

const router = express.Router();

router.post('/register', auth.register);
router.post('/login', auth.login);
router.post('/refresh', auth.refresh);
router.get('/me', authJwt, auth.me);

module.exports = router;
