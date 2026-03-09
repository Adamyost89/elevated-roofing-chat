(function () {
  'use strict';

  var BASE = (function () {
    var script = document.currentScript;
    var src = script && script.src;
    if (src) {
      var a = document.createElement('a');
      a.href = src;
      return a.origin + a.pathname.replace(/\/[^/]+$/, '');
    }
    return window.ER_CHAT_BASE_URL || '';
  })();
  if (!BASE && typeof window !== 'undefined' && window.location) BASE = window.location.origin;
  if (!BASE) {
    console.warn('Elevated Roofing Chat: could not detect base URL. Set window.ER_CHAT_BASE_URL.');
    return;
  }

  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = BASE + '/widget.css';
  document.head.appendChild(link);

  var root = document.createElement('div');
  root.id = 'er-chat-root';
  document.body.appendChild(root);

  var conversationId = null;
  var visitorId = null;
  var ws = null;
  var settings = { delay_seconds: 3, welcome_text: 'Hi! How can we help you today?', primary_color: '#2563eb', position: 'bottom-right' };

  function getCookie(name) {
    var m = document.cookie.match(new RegExp('(?:^| )' + name + '=([^;]+)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  function loadSettings(cb) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', BASE + '/api/widget-settings', true);
    xhr.withCredentials = true;
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status === 200) {
        try {
          var s = JSON.parse(xhr.responseText);
          settings.delay_seconds = s.delay_seconds != null ? s.delay_seconds : 3;
          settings.welcome_text = s.welcome_text || settings.welcome_text;
          settings.primary_color = s.primary_color || settings.primary_color;
          settings.position = s.position || 'bottom-right';
        } catch (e) {}
      }
      if (typeof cb === 'function') cb();
    };
    xhr.send();
  }

  function ensureConversation(cb) {
    if (conversationId && visitorId) {
      if (typeof cb === 'function') cb();
      return;
    }
    visitorId = getCookie('chat_visitor_id') || null;
    var xhr = new XMLHttpRequest();
    xhr.open('POST', BASE + '/api/conversations', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.withCredentials = true;
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status === 200) {
        try {
          var d = JSON.parse(xhr.responseText);
          conversationId = d.conversation_id;
          visitorId = d.visitor_id;
        } catch (e) {}
      }
      if (typeof cb === 'function') cb();
    };
    xhr.send(JSON.stringify({ visitor_id: visitorId }));
  }

  function connectWs() {
    if (!conversationId) return;
    var proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    var host = (BASE.match(/^https?:\/\/([^/]+)/) || [])[1] || window.location.host;
    var url = proto + '//' + host + '/ws?conversation_id=' + encodeURIComponent(conversationId);
    try {
      ws = new WebSocket(url);
      ws.onmessage = function (ev) {
        try {
          var p = JSON.parse(ev.data);
          if (p.type === 'new_message' && p.message && p.message.sender_type === 'agent') appendMessage(p.message);
        } catch (e) {}
      };
    } catch (e) {}
  }

  function appendMessage(msg) {
    var list = root.querySelector('.er-chat-messages');
    if (!list) return;
    if (msg.id && list.querySelector('[data-msg-id="' + msg.id + '"]')) return;
    var div = document.createElement('div');
    if (msg.id) div.setAttribute('data-msg-id', String(msg.id));
    div.className = 'er-chat-msg ' + (msg.sender_type === 'agent' ? 'agent' : 'visitor');
    div.style.backgroundColor = msg.sender_type === 'agent' ? settings.primary_color : '';
    div.innerHTML = '<span class="er-chat-msg-text"></span><span class="er-chat-msg-time"></span>';
    div.querySelector('.er-chat-msg-text').textContent = msg.body || '';
    div.querySelector('.er-chat-msg-time').textContent = msg.created_at ? new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    list.appendChild(div);
    list.scrollTop = list.scrollHeight;
  }

  function loadMessages() {
    if (!conversationId) return;
    var xhr = new XMLHttpRequest();
    xhr.open('GET', BASE + '/api/conversations/' + encodeURIComponent(conversationId) + '/messages', true);
    xhr.withCredentials = true;
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status === 200) {
        try {
          var d = JSON.parse(xhr.responseText);
          var list = root.querySelector('.er-chat-messages');
          if (list) {
            list.innerHTML = '<div class="er-chat-welcome">' + (settings.welcome_text || '') + '</div>';
            (d.messages || []).forEach(appendMessage);
            if ((d.messages || []).length > 0) {
              var w = list.querySelector('.er-chat-welcome');
              if (w) w.style.display = 'none';
            }
          }
        } catch (e) {}
      }
    };
    xhr.send();
  }

  function sendMessage(body) {
    if (!conversationId || !body || !body.trim()) return;
    var xhr = new XMLHttpRequest();
    xhr.open('POST', BASE + '/api/conversations/' + encodeURIComponent(conversationId) + '/messages', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.withCredentials = true;
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status === 200) {
        try {
          var d = JSON.parse(xhr.responseText);
          if (d.message) appendMessage(d.message);
        } catch (e) {}
      }
    };
    xhr.send(JSON.stringify({ body: body.trim() }));
  }

  function renderLauncher() {
    var el = document.createElement('button');
    el.className = 'er-chat-launcher ' + settings.position;
    el.style.backgroundColor = settings.primary_color;
    el.setAttribute('aria-label', 'Open chat');
    el.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';
    el.onclick = function () {
      el.style.display = 'none';
      showWindow();
    };
    root.appendChild(el);
  }

  function showWindow() {
    if (root.querySelector('.er-chat-window')) return;
    ensureConversation(function () {
      connectWs();
      loadMessages();
      var wrap = document.createElement('div');
      wrap.className = 'er-chat-window ' + settings.position;
      wrap.innerHTML =
        '<div class="er-chat-header" style="background:' + settings.primary_color + '">' +
        '<h3>Chat with us</h3>' +
        '</div>' +
        '<div class="er-chat-messages">' +
        '<div class="er-chat-welcome">' + (settings.welcome_text || '') + '</div>' +
        '</div>' +
        '<div class="er-chat-input-area">' +
        '<div class="er-chat-input-row">' +
        '<textarea class="er-chat-input" rows="1" placeholder="Type a message..."></textarea>' +
        '<button class="er-chat-send" style="background:' + settings.primary_color + '" type="button" aria-label="Send">' +
        '<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>' +
        '</button>' +
        '</div>' +
        '</div>';
      var header = wrap.querySelector('.er-chat-header');
      var messages = wrap.querySelector('.er-chat-messages');
      var welcome = wrap.querySelector('.er-chat-welcome');
      var input = wrap.querySelector('.er-chat-input');
      var sendBtn = wrap.querySelector('.er-chat-send');

      var onNewMessage = function () {
        if (welcome) welcome.style.display = 'none';
      };
      var origAppend = appendMessage;
      appendMessage = function (msg) {
        onNewMessage();
        origAppend(msg);
      };
      if (messages && messages.children.length > 0) onNewMessage();

      sendBtn.onclick = function () {
        var text = input.value.trim();
        if (!text) return;
        sendMessage(text);
        input.value = '';
      };
      input.onkeydown = function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendBtn.click();
        }
      };

      root.appendChild(wrap);

      var launcher = root.querySelector('.er-chat-launcher');
      var closeBtn = document.createElement('button');
      closeBtn.style.cssText = 'position:absolute;top:8px;right:8px;background:transparent;border:none;color:white;cursor:pointer;font-size:20px;line-height:1;padding:4px;';
      closeBtn.textContent = '\u00D7';
      closeBtn.setAttribute('aria-label', 'Close chat');
      closeBtn.onclick = function () {
        wrap.remove();
        if (launcher) launcher.style.display = 'flex';
      };
      header.appendChild(closeBtn);

      setTimeout(function () { input.focus(); }, 100);
    });
  }

  function bootstrap() {
    loadSettings(function () {
      setTimeout(function () {
        renderLauncher();
      }, (settings.delay_seconds || 0) * 1000);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
