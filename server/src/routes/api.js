const express = require('express');
const multer = require('multer');
const api = require('../controllers/apiController');
const apiKey = require('../middleware/apiKey');

const router = express.Router();

// Store uploads in MongoDB (GridFS). We use tmp files to avoid loading large videos into RAM.
const upload = multer({ dest: '/tmp/wablas_uploads' });

router.use(apiKey);

router.post('/send-text', api.sendText);
router.post('/send-media', api.sendMedia);
router.get('/history/chats', api.listChats);
router.get('/history/chats/:waChatId', api.chatHistory);
router.get('/list-ids', api.listChatIds);
router.get('/stats', api.stats);
router.put('/chats/:waChatId/display-name', api.setChatDisplayName);
router.post('/upload', upload.single('file'), api.upload);

module.exports = router;
