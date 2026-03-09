const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

const SCOPES = [
  'https://www.googleapis.com/auth/chat.messages',
  'https://www.googleapis.com/auth/chat.app.messages.readonly',
];

let chatClient = null;

function getChatClient() {
  if (chatClient) return chatClient;
  const credentialsPath =
    process.env.GOOGLE_CHAT_CREDENTIALS_PATH ||
    path.join(__dirname, '..', 'elevated-roofing-website-chat-d56faccd129d.json');
  const keyPath = path.isAbsolute(credentialsPath) ? credentialsPath : path.resolve(__dirname, credentialsPath);
  if (!fs.existsSync(keyPath)) {
    throw new Error(`Google credentials not found at ${keyPath}. Set GOOGLE_CHAT_CREDENTIALS_PATH.`);
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: SCOPES,
  });
  chatClient = google.chat({ version: 'v1', auth });
  return chatClient;
}

const SPACE_ID = process.env.GOOGLE_CHAT_SPACE_ID || 'AAQAJjD8_Ho';

function getSpaceName() {
  return `spaces/${SPACE_ID}`;
}

async function postMessageToThread(conversationId, text, isVisitor = true) {
  const chat = getChatClient();
  const spaceName = getSpaceName();
  const res = await chat.spaces.messages.create({
    parent: spaceName,
    requestBody: {
      text: text,
      thread: { threadKey: conversationId },
    },
    messageReplyOption: 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD',
  });
  return res.data;
}

async function listMessages(pageSize = 100, pageToken = null) {
  const chat = getChatClient();
  const spaceName = getSpaceName();
  try {
    const res = await chat.spaces.messages.list({
      parent: spaceName,
      pageSize,
      pageToken: pageToken || undefined,
    });
    return res.data;
  } catch (err) {
    if (err.code === 403 || err.message?.includes('not enabled')) {
      return null;
    }
    throw err;
  }
}

module.exports = {
  getSpaceName,
  SPACE_ID,
  postMessageToThread,
  listMessages,
};
