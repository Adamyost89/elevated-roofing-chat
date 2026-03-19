const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const { getDb } = require('./db');

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

function getUserListAuth() {
  try {
    const db = getDb();
    const row = db.prepare('SELECT refresh_token FROM chat_sync_credentials WHERE id = 1 AND refresh_token != ?').get('');
    if (!row || !row.refresh_token) return null;
    const oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.BASE_URL + '/auth/chat-sync/callback'
    );
    oauth2.setCredentials({ refresh_token: row.refresh_token });
    return oauth2;
  } catch {
    return null;
  }
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
  const spaceName = getSpaceName();
  const listOpts = { parent: spaceName, pageSize, pageToken: pageToken || undefined };

  const userAuth = getUserListAuth();
  if (userAuth) {
    try {
      const chat = google.chat({ version: 'v1', auth: userAuth });
      const res = await chat.spaces.messages.list(listOpts);
      listMessages._loggedUserAuthFail = false;
      return res.data;
    } catch (err) {
      if (err.code === 401 || err.message?.includes('invalid_grant') || err.message?.includes('Token has been expired')) {
        if (!listMessages._loggedUserAuthFail) {
          listMessages._loggedUserAuthFail = true;
          console.warn('Chat list (user auth): token expired or invalid. Reconnect in Admin -> Connect Google Chat. Falling back to app auth.');
        }
      } else {
        console.error('Chat list (user auth) error:', err.message);
      }
    }
  }

  try {
    const chat = getChatClient();
    const res = await chat.spaces.messages.list(listOpts);
    return res.data;
  } catch (err) {
    if (err.code === 403 || err.message?.includes('not enabled')) {
      if (!listMessages._logged403) {
        listMessages._logged403 = true;
        console.warn('Chat list (app): 403. Connect a Google account in Admin -> Connect Google Chat so replies in Chat sync to the widget.');
      }
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
