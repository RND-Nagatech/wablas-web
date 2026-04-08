const express = require('express');
const wa = require('../controllers/waController');
const authJwt = require('../middleware/authJwt');

const router = express.Router();

router.use(authJwt);
router.get('/status', wa.status);
router.post('/connect', wa.connect);
router.get('/qr', wa.qr);
router.post('/disconnect', wa.disconnect);
router.post('/reset', wa.reset);

module.exports = router;
