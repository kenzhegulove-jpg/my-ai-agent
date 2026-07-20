(() => {
  'use strict';

  // ---------- Константы и ключи хранения ----------
  const STORAGE_KEYS = {
    apiKey: 'ai_assistant_api_key',
    mode: 'ai_assistant_mode',
    chatHistory: 'chat_history',
  };

  const API_URL = 'https://api.groq.com/openai/v1/chat/completions';
  const API_MODEL = 'llama-3.3-70b-versatile';

  // Сколько последних сообщений истории отправлять модели для контекста
  const HISTORY_LIMIT = 10;

  // ---------- DOM-элементы ----------
  const modeSelect = document.getElementById('mode-select');
  const apiKeyWrapper = document.getElementById('api-key-wrapper');
  const apiKeyInput = document.getElementById('api-key-input');
  const chatMessages = document.getElementById('chat-messages');
  const messageInput = document.getElementById('message-input');
  const sendButton = document.getElementById('send-button');
  const clearChatButton = document.getElementById('clear-chat-button');

  // Локальная история переписки в формате { role: 'user' | 'assistant', content: string }
  const conversationHistory = [];

  // Строка, в которую мы склеим реальное текстовое содержимое всех файлов из docs/
  let aiKnowledgeText = "";

  // ---------- Инициализация ----------
  function init() {
    restoreSettings();
    restoreChatHistory();
    bindEvents();
    autoResizeTextarea();
    loadKnowledgeBase();
  }

  // Обновленная функция: читает json, а затем скачивает контент каждого txt-файла
  async function loadKnowledgeBase() {
    try {
      const response = await fetch('knowledge.json', {
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) {
        console.warn(`knowledge.json не найден или недоступен (статус ${response.status}). Работаем без базы знаний.`);
        return;
      }

      const config = await response.json();
      
      if (!config || !Array.isArray(config.text_files) || config.text_files.length === 0) {
        console.log('Список файлов в knowledge.json пуст.');
        return;
      }

      let combinedText = "";

      // Перебираем массив путей (например, ["docs/about.txt", "docs/contacts.txt"])
      for (const filePath of config.text_files) {
        try {
          console.log(`Загрузка текста из файла: ${filePath}`);
          const fileResponse = await fetch(filePath);
          
          if (fileResponse.ok) {
            const text = await fileResponse.text();
            // Красиво разграничиваем документы для нейросети
            combinedText += `\n--- ДАННЫЕ ИЗ ФАЙЛА ${filePath} ---\n${text}\n`;
          } else {
            console.error(`Не удалось прочитать файл базы знаний ${filePath}: ${fileResponse.status}`);
          }
        } catch (fileError) {
          console.error(`Ошибка при скачивании файла ${filePath}:`, fileError);
        }
      }

      aiKnowledgeText = combinedText.trim();
      if (aiKnowledgeText) {
        console.log('Все файлы базы знаний успешно загружены и склеены!');
      }

    } catch (error) {
      console.warn('Не удалось загрузить конфигурацию базы знаний. Работаем без неё.', error);
      aiKnowledgeText = "";
    }
  }

  // Восстанавливает историю переписки из localStorage и отображает ее в чате
  function restoreChatHistory() {
    const savedHistory = localStorage.getItem(STORAGE_KEYS.chatHistory);
    if (!savedHistory) return;

    let parsedHistory;
    try {
      parsedHistory = JSON.parse(savedHistory);
    } catch (error) {
      console.warn('Не удалось распарсить сохраненную историю чата:', error);
      localStorage.removeItem(STORAGE_KEYS.chatHistory);
      return;
    }

    if (!Array.isArray(parsedHistory) || parsedHistory.length === 0) return;

    parsedHistory.forEach((item) => {
      if (!item || !item.role || !item.content) return;
      conversationHistory.push(item);
      const sender = item.role === 'user' ? 'user' : 'bot';
      addMessage(item.content, sender, { smooth: false });
    });
  }

  // Восстанавливаем сохраненные настройки (режим и API-ключ) из localStorage
  function restoreSettings() {
    const savedMode = localStorage.getItem(STORAGE_KEYS.mode);
    if (savedMode) {
      modeSelect.value = savedMode;
    }

    const savedApiKey = localStorage.getItem(STORAGE_KEYS.apiKey);
    if (savedApiKey) {
      apiKeyInput.value = savedApiKey;
    }

    toggleApiKeyField();
  }

  // ---------- Обработчики событий ----------
  function bindEvents() {
    modeSelect.addEventListener('change', () => {
      localStorage.setItem(STORAGE_KEYS.mode, modeSelect.value);
      toggleApiKeyField();
    });

    apiKeyInput.addEventListener('input', () => {
      localStorage.setItem(STORAGE_KEYS.apiKey, apiKeyInput.value);
    });

    sendButton.addEventListener('click', handleSend);

    messageInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        handleSend();
      }
    });

    messageInput.addEventListener('input', autoResizeTextarea);

    clearChatButton.addEventListener('click', handleClearChat);
  }

  function toggleApiKeyField() {
    if (modeSelect.value === 'api') {
      apiKeyWrapper.classList.remove('hidden');
    } else {
      apiKeyWrapper.classList.add('hidden');
    }
  }

  function autoResizeTextarea() {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 160) + 'px';
  }

  // ---------- Логика отправки сообщений ----------
  function handleSend() {
    const text = messageInput.value.trim();
    if (!text) return;

    conversationHistory.push({ role: 'user', content: text });
    saveChatHistory();
    addMessage(text, 'user');

    messageInput.value = '';
    autoResizeTextarea();

    fetchAIResponse();
  }

  function saveChatHistory() {
    localStorage.setItem(STORAGE_KEYS.chatHistory, JSON.stringify(conversationHistory));
  }

  function handleClearChat() {
    const confirmed = window.confirm('Удалить всю историю переписки? Это действие необратимо.');
    if (!confirmed) return;

    conversationHistory.length = 0;
    localStorage.removeItem(STORAGE_KEYS.chatHistory);
    chatMessages.innerHTML = '';
  }

  // Собирает системный промпт, подставляя РЕАЛЬНЫЙ текст документов
  function buildSystemPrompt() {
    const basePrompt = 'Ты полезный ИИ-ассистент.';

    if (!aiKnowledgeText) {
      return `${basePrompt} Отвечай на основе своих общих знаний.`;
    }

    return `${basePrompt} Используй следующую базу знаний для ответов на вопросы пользователя, если в ней есть нужная информация:\n\n${aiKnowledgeText}\n\nЕсли в базе знаний нет ответа, отвечай на основе своих общих знаний.`;
  }

  // Делает запрос к внешнему API и выводит ответ ассистента в чат
  async function fetchAIResponse() {
    const apiKey = localStorage.getItem(STORAGE_KEYS.apiKey);

    if (!apiKey) {
      addErrorMessage('Пожалуйста, введите ваш API-ключ в настройках сверху!');
      return;
    }

    const typingBubble = showTypingIndicator();
    const recentHistory = conversationHistory.slice(-HISTORY_LIMIT);
    const systemPrompt = buildSystemPrompt();
    const messagesToSend = [{ role: 'system', content: systemPrompt }, ...recentHistory];

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: API_MODEL,
          messages: messagesToSend,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Сервер вернул ошибку ${response.status}. ${errorText}`);
      }

      const data = await response.json();
      const reply = data?.choices?.[0]?.message?.content?.trim();

      removeTypingIndicator(typingBubble);

      if (!reply) {
        addErrorMessage('Ответ от ИИ пришел пустым. Попробуйте еще раз.');
        return;
      }

      addMessage(reply, 'bot');
      conversationHistory.push({ role: 'assistant', content: reply });
      saveChatHistory();

    } catch (error) {
      removeTypingIndicator(typingBubble);
      addErrorMessage(`Не удалось получить ответ: ${error.message}`);
    }
  }

  function createAvatar(sender) {
    const avatar = document.createElement('div');
    avatar.className = 'message__avatar';
    avatar.textContent = sender === 'user' ? '👤' : '🤖';
    return avatar;
  }

  function addMessage(text, sender, { smooth = true } = {}) {
    const messageEl = document.createElement('div');
    messageEl.className = `message message--${sender}`;

    const bubble = document.createElement('div');
    bubble.className = 'message__bubble';
    bubble.textContent = sender === 'user' ? `Вы: ${text}` : text;

    messageEl.appendChild(createAvatar(sender));
    messageEl.appendChild(bubble);
    chatMessages.appendChild(messageEl);

    scrollToBottom(smooth);
    return messageEl;
  }

  function addErrorMessage(text) {
    const messageEl = document.createElement('div');
    messageEl.className = 'message message--bot';

    const bubble = document.createElement('div');
    bubble.className = 'message__bubble message__bubble--error';
    bubble.textContent = `⚠️ ${text}`;

    messageEl.appendChild(createAvatar('bot'));
    messageEl.appendChild(bubble);
    chatMessages.appendChild(messageEl);

    scrollToBottom();
    return messageEl;
  }

  // Показывает индикатор "печатает..." — три пульсирующие точки
  function showTypingIndicator() {
    const messageEl = document.createElement('div');
    messageEl.className = 'message message--bot message--typing';

    const bubble = document.createElement('div');
    bubble.className = 'message__bubble message__bubble--typing';
    bubble.innerHTML = '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>';

    messageEl.appendChild(createAvatar('bot'));
    messageEl.appendChild(bubble);
    chatMessages.appendChild(messageEl);

    scrollToBottom();
    return messageEl;
  }

  function removeTypingIndicator(el) {
    if (el && el.parentNode) {
      el.parentNode.removeChild(el);
    }
  }

  function scrollToBottom(smooth = true) {
    const chatWindow = chatMessages.parentElement;
    chatWindow.scrollTo({
      top: chatWindow.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto',
    });
  }

  // ---------- Запуск ----------
  document.addEventListener('DOMContentLoaded', init);
})();
