// ===== 工具定义 =====
const SEARCH_TOOL = {
  type: 'function',
  function: {
    name: 'web_search',
    description: '搜索互联网获取实时信息。当用户询问新闻、最新动态、当前事件、天气、股价等需要最新数据的问题时使用。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' }
      },
      required: ['query']
    }
  }
};

// ===== 状态 =====
let currentPet = null;
let messages = [];
let isLoading = false;
let currentModel = 'deepseek-v4-flash'; // 默认聊天模式

// DOM
let chatMessages, chatInput, btnSend, modeToggle;

// ===== 初始化 =====
let petId = '__default__';

async function init() {
  chatMessages = document.getElementById('chat-messages');
  chatInput = document.getElementById('chat-input');
  btnSend = document.getElementById('btn-send');

  // 从 URL hash 获取宠物 ID
  petId = decodeURIComponent(window.location.hash.slice(1)) || '__default__';

  const pets = await window.api.getPets();
  currentPet = pets.find(p => p.id === petId);
  if (!currentPet && pets.length > 0) currentPet = pets[0];
  if (currentPet) {
    document.getElementById('chat-title').textContent = currentPet.displayName;
  }

  // 加载历史记录
  const history = await window.api.loadChatHistory(petId);
  if (history && history.length > 0) {
    messages = history;
    for (const msg of messages) {
      addMessageDom(msg.role, msg.content);
    }
  }

  // 模式切换
  modeToggle = document.getElementById('mode-toggle');
  modeToggle.onclick = toggleMode;

  // 事件
  btnSend.onclick = sendMessage;
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  document.getElementById('btn-close').onclick = () => window.close();
  document.getElementById('btn-minimize').onclick = () => window.api.minimizeChatWindow();

  // 监听文件拖拽对话
  window.api.onChatFileDrop(async (data) => {
    const hasContent = data.content && data.content.length > 0;
    addMessage('system', `📎 已收到文件: ${data.fileName}${hasContent ? ' (' + data.content.length + ' 字符)' : ''}`);

    if (hasContent) {
      const prompt = `用户拖拽了一个文件"${data.fileName}"，内容如下：

\`\`\`
${data.content}
\`\`\`

请用你的角色口吻，先简单说明已收到文件，然后对内容进行总结（提取关键信息、要点），最后询问用户是否需要进一步分析。`;
      await callDeepSeek(prompt, true);
    } else if (data.error) {
      addMessage('assistant', `抱歉，读取"${data.fileName}"时出错了：${data.error}`);
    } else {
      addMessage('assistant', `"${data.fileName}" 已暂存到"暂存文件"文件夹。（该文件格式暂不支持文本提取）`);
    }
  });

  // 每次打开都自动问候
  await doGreeting();
}

function toggleMode() {
  if (currentModel === 'deepseek-v4-flash') {
    currentModel = 'deepseek-v4-pro';
    document.getElementById('mode-chat').classList.remove('mode-active');
    document.getElementById('mode-work').classList.add('mode-active');
  } else {
    currentModel = 'deepseek-v4-flash';
    document.getElementById('mode-work').classList.remove('mode-active');
    document.getElementById('mode-chat').classList.add('mode-active');
  }
}

// ===== 自动问候 =====
async function doGreeting() {
  const now = new Date();
  const timeStr = now.toLocaleString('zh-CN', { hour12: false });
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
  const nickname = (await window.api.getNickname()) || '朋友';
  const today = `${now.getMonth() + 1}-${now.getDate()}`;

  // 判断今天是否已打过招呼（通过 localStorage）
  const lastGreetDate = localStorage.getItem('lastGreet_' + petId);
  const isFirstToday = lastGreetDate !== today;
  if (isFirstToday) localStorage.setItem('lastGreet_' + petId, today);

  let greetMsg;

  if (isFirstToday) {
    // 每天首次：时间 + 天气
    let weatherInfo = '';
    try {
      const wx = await Promise.race([
        window.api.getWeather(),
        new Promise(r => setTimeout(() => r(null), 3000))
      ]);
      if (wx && wx !== '天气数据不可用') {
        const w = JSON.parse(wx);
        weatherInfo = `地点: ${w.city}\n天气: ${w.condition}，气温 ${w.temp}，体感 ${w.feelsLike}，湿度 ${w.humidity}，${w.wind}`;
      }
    } catch {}
    const wxBlock = weatherInfo ? `\n\n实时天气：${weatherInfo}` : '';
    greetMsg = `现在是${timeStr}，星期${weekday}。${wxBlock}

你就是你自己。请用角色最自然的方式向"${nickname}"打招呼，结合当前时间和天气开启新的一天。`;
  } else {
    // 非首次：随机应变，参考聊天历史找话题
    const historyText = messages.slice(-6).map(m => `[${m.role === 'user' ? nickname : '你'}]: ${m.content.slice(0, 80)}`).join('\n');
    const topics = [
      '根据你们之前的聊天内容，主动延续之前的话题',
      '分享一个符合你角色设定的有趣经历或故事',
      '关心对方上次提到的事情进展如何',
      '聊聊最近你角色世界里发生的事情',
      '用你角色的方式吐槽或分享今天的心情'
    ];
    const topic = topics[Math.floor(Math.random() * topics.length)];
    greetMsg = `现在是${timeStr}。

你和"${nickname}"最近的聊天记录：
${historyText || '（暂无记录）'}

请用角色最自然的方式主动打招呼。${topic}。不要重复之前的开场白，要让人觉得你真的记得之前的对话。`;
  }

  await callDeepSeek(greetMsg, false);
}

// ===== 消息 =====
function addMessageDom(role, text) {
  const div = document.createElement('div');
  div.className = `message ${role}`;
  if (role === 'assistant' && currentPet) {
    div.innerHTML = `<div class="sender">${currentPet.displayName}</div>${formatMessage(text)}`;
  } else if (role === 'assistant') {
    div.innerHTML = formatMessage(text);
  } else {
    div.textContent = text;
  }
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return div;
}

function addMessage(role, text, reasoningContent) {
  const msg = { role, content: text };
  if (reasoningContent) msg.reasoning_content = reasoningContent;
  messages.push(msg);
  window.api.saveChatHistory(petId, messages);
  return addMessageDom(role, text);
}

function addTypingIndicator() {
  const div = document.createElement('div');
  div.className = 'message assistant';
  div.id = 'typing-indicator';
  div.innerHTML = '<div class="sender">' + (currentPet ? currentPet.displayName : '宠物') + '</div>' +
    '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>';
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function removeTypingIndicator() {
  const el = document.getElementById('typing-indicator');
  if (el) el.remove();
}

// ===== 发送消息 =====
async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text || isLoading) return;

  chatInput.value = '';
  addMessage('user', text);
  isLoading = true;
  btnSend.disabled = true;
  addTypingIndicator();

  // 检测天气查询
  const askWeather = /天气|下雨|刮风|下雪|温度|气温|热不热|冷不冷|带伞|防晒|雾霾/.test(text);
  let weatherBlock = '';
  if (askWeather) {
    try {
      const wx = await window.api.getWeather();
      if (wx && wx !== '天气数据不可用') {
        const w = JSON.parse(wx);
        weatherBlock = `\n\n[实时天气数据：${w.city}: ${w.condition}，气温${w.temp}，体感${w.feelsLike}，湿度${w.humidity}，${w.wind}。请根据此真实天气回答用户。]`;
        addMessage('system', `📍 ${w.city}: ${w.condition} ${w.temp}`);
      }
    } catch {}
  }

  const systemPrompt = await buildSystemPrompt();

  const apiMessages = [
    { role: 'system', content: systemPrompt + weatherBlock },
    ...messages.filter(m => m.role !== 'system').slice(-10).map(m => {
      const msg = { role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content };
      if (m.reasoning_content) msg.reasoning_content = m.reasoning_content;
      return msg;
    })
  ];

  const result = await window.api.deepseekChat({
    messages: apiMessages,
    tools: [SEARCH_TOOL],
    model: currentModel,
    temperature: 0.8
  });

  removeTypingIndicator();
  isLoading = false;
  btnSend.disabled = false;

  if (result.error) {
    addMessage('assistant', '呜...好像出了点问题：' + result.error);
  } else {
    addMessage('assistant', result.content, result.reasoning_content);
    window.api.notifyPetTalk();
  }
}

async function callDeepSeek(userMessage, isFileContext) {
  isLoading = true;
  addTypingIndicator();

  const sp = await buildSystemPrompt();
  const apiMessages = [
    { role: 'system', content: sp },
    { role: 'user', content: userMessage }
  ];

  const result = await window.api.deepseekChat({
    messages: apiMessages,
    tools: [SEARCH_TOOL],
    model: currentModel,
    temperature: 0.8
  });

  removeTypingIndicator();
  isLoading = false;
  btnSend.disabled = false;

  if (result.error) {
    addMessage('assistant', '呜...好像出了点问题：' + result.error);
  } else {
    addMessage('assistant', result.content, result.reasoning_content);
    window.api.notifyPetTalk();
  }
}

// ===== 系统提示词 =====
let cachedWeather = '';

async function buildSystemPrompt() {
  const now = new Date();
  const timeContext = `当前时间: ${now.toLocaleString('zh-CN', { hour12: false })}`;
  const nickname = (await window.api.getNickname()) || '朋友';

  // 获取天气（缓存5分钟）
  if (!cachedWeather) {
    try {
      const wx = await Promise.race([
        window.api.getWeather(),
        new Promise(r => setTimeout(() => r(null), 3000))
      ]);
      if (wx && wx !== '天气数据不可用') {
        const w = JSON.parse(wx);
        cachedWeather = `${w.city}: ${w.condition}，${w.temp}，体感${w.feelsLike}`;
        setTimeout(() => { cachedWeather = ''; }, 300000);
      }
    } catch {}
  }

  const wxContext = cachedWeather ? `\n天气: ${cachedWeather}` : '';

  if (!currentPet) {
    return `你称呼用户为"${nickname}"。${timeContext}${wxContext}\n用简短自然的语气和用户交流。`;
  }

  return `你是${currentPet.displayName}。

${currentPet.description}

${timeContext}${wxContext}

对话核心规则：
你就是${currentPet.displayName}本人，不是AI助手，不是桌面宠物软件。你的每一句话、每一个反应、每一个用词，都必须完全来自这个角色的身份、经历、性格和世界观。

具体来说：
- 用该角色的口头禅、语气词、标志性说话方式
- 知识范围和认知方式应符合角色设定（该知道的知道，不该知道的不懂）
- 表达情绪和反应的方式完全贴合角色性格
- 偶尔可以用 *动作描写*（用星号包裹）来增强代入感，如 *推了推眼镜*、*露出灿烂的笑容* 等，不要每句都用
- 当用户问你的身份相关问题时，回答必须忠于原作设定

功能层面：
- 你可以正常回答任何问题、搜索互联网、总结文件、查询天气——这些能力不影响你的角色扮演
- 【重要】当用户的问题涉及当前新闻、最新动态、实时信息、或任何超出你知识截止日期（2024年7月）的内容时，你**必须**先调用 web_search 工具搜索，然后基于搜索结果用角色方式回答。禁止凭空编造关于近期事件的信息。
- 当搜索返回结果时，用角色的方式解读和转述
- 当不知道答案时，用角色的方式诚实表达，不要跳出角色说"作为AI我无法..."
- 始终保持角色状态，不要在回复中出现"作为AI""根据搜索结果"等出戏表述

称呼用户为"${nickname}"。`;
}

function formatMessage(text) {
  // 过滤模型可能在文本中输出的 tool call 语法
  text = text.replace(/<\/?[a-z_-]*tool[s]?_?calls[a-z_-]*[^>]*>[\s\S]*?<\/[a-z_-]*tool[s]?_?calls[a-z_-]*[^>]*>/gi, (m) => {
    // 先过滤内容里的子标签
    return m.replace(/<invoke[^>]*>[\s\S]*?<\/invoke>/gi, '')
            .replace(/<parameter[^>]*>[\s\S]*?<\/parameter>/gi, '')
            .replace(/<[a-z_-]*function[^>]*>[\s\S]*?<\/[a-z_-]*function[^>]*>/gi, '');
  });
  text = text.replace(/<invoke[^>]*>[\s\S]*?<\/invoke>/gi, '');
  text = text.replace(/<parameter[^>]*>[\s\S]*?<\/parameter>/gi, '');
  text = text.replace(/<[a-z_-]*function[^>]*>[\s\S]*?<\/[a-z_-]*function[^>]*>/gi, '');
  text = text.replace(/web_search\s*\([^)]*\)/gi, '');
  // 清理可能残留的空行
  text = text.replace(/\n{3,}/g, '\n\n');
  // 先转义 HTML
  const div = document.createElement('div');
  div.textContent = text;
  let html = div.innerHTML;

  // Markdown 解析
  html = html
    // 动作描述 *text* 或 ＊text＊ → 特殊样式
    .replace(/[*＊]([^*＊\n]+?)[*＊]/g, '<span class="action">$1</span>')
    // 粗体 **text**
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // 行内代码 `code`
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // 无序列表 - item 或 * item
    .replace(/^[*-] (.+)$/gm, '<li>$1</li>')
    // 有序列表 1. item
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // 连续的 <li> 包裹 <ul>
    .replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>')
    // 双换行 → 段落分隔
    .replace(/\n\n+/g, '</p><p>')
    // 单换行 → <br>
    .replace(/\n/g, '<br>');

  // 包裹在 <p> 中
  html = '<p>' + html + '</p>';

  // 清理空段落
  html = html.replace(/<p><\/p>/g, '');
  html = html.replace(/<p><br><\/p>/g, '');

  return html;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => init().catch(err => console.error('Chat init error:', err)));
} else {
  init().catch(err => console.error('Chat init error:', err));
}
