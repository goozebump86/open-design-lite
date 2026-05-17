const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware ---
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- Paths ---
const PROJECTS_DIR = path.join(__dirname, 'projects');
const SKILLS_DIR = path.join(__dirname, 'skills');
const DESIGN_SYSTEMS_DIR = path.join(__dirname, 'design-systems');
const TEMPLATES_DIR = path.join(__dirname, 'templates');
const SETTINGS_FILE = path.join(__dirname, 'settings.json');
const OD_DIR = path.join(__dirname, '.od');
const MEMORY_DIR = path.join(OD_DIR, 'memory');

// Ensure directories exist
[PROJECTS_DIR, SKILLS_DIR, DESIGN_SYSTEMS_DIR, TEMPLATES_DIR, OD_DIR, MEMORY_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// --- Helper: Load Settings ---
function loadSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { apiKey: '', apiProvider: 'anthropic', model: 'claude-sonnet-4-20250514', maxTokens: 8192, theme: 'light', accentColor: '#3b82f6', agentId: null, designSystemId: null, defaultProjectLocation: '', autoSave: true, chatPanelWidth: 460, onboardingCompleted: false, llamaCppUrl: 'http://localhost:8080', llamaCppKey: '', ollamaUrl: 'http://localhost:11434' };
  }
}

function saveSettings(settings) {
  const tmpFile = SETTINGS_FILE + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(settings, null, 2));
  fs.renameSync(tmpFile, SETTINGS_FILE); // Atomic rename on most OS
}

// --- Helper: Parse YAML frontmatter from .md files ---
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { metadata: {}, body: content };
  const metadata = {};
  const lines = match[1].split('\n');
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    let value = line.slice(colonIndex + 1).trim();
    // Handle arrays like triggers: [a, b, c]
    if (value.startsWith('[') && value.endsWith(']')) {
      value = value.slice(1, -1).split(',').map(v => v.trim().replace(/['"]/g, ''));
    } else {
      value = value.replace(/['"]/g, '');
    }
    metadata[key] = value;
  }
  const body = content.slice(match[0].length).trim();
  return { metadata, body };
}

// --- Helper: Load all skills ---
function loadSkills() {
  const skills = [];
  if (!fs.existsSync(SKILLS_DIR)) return skills;
  const entries = fs.readdirSync(SKILLS_DIR);
  for (const entry of entries) {
    const skillPath = path.join(SKILLS_DIR, entry);
    if (!fs.statSync(skillPath).isDirectory()) continue;
    const skillMdPath = path.join(skillPath, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) continue;
    const content = fs.readFileSync(skillMdPath, 'utf-8');
    const { metadata, body } = parseFrontmatter(content);
    skills.push({
      id: entry,
      name: metadata.name || entry,
      description: metadata.description || '',
      triggers: metadata.triggers || [],
      mode: metadata.mode || 'default',
      body: body
    });
  }
  return skills;
}

// --- Helper: Load all design systems ---
function loadDesignSystems() {
  const systems = [];
  if (!fs.existsSync(DESIGN_SYSTEMS_DIR)) return systems;
  const entries = fs.readdirSync(DESIGN_SYSTEMS_DIR);
  for (const entry of entries) {
    const dsPath = path.join(DESIGN_SYSTEMS_DIR, entry);
    if (!fs.statSync(dsPath).isDirectory()) continue;
    const designMdPath = path.join(dsPath, 'DESIGN.md');
    if (!fs.existsSync(designMdPath)) continue;
    const content = fs.readFileSync(designMdPath, 'utf-8');
    const { metadata, body } = parseFrontmatter(content);
    systems.push({
      id: entry,
      name: metadata.name || entry,
      description: metadata.description || '',
      tokens: metadata.tokens || {},
      body: body
    });
  }
  return systems;
}

// --- Helper: Load projects ---
function loadProjects() {
  const projects = [];
  if (!fs.existsSync(PROJECTS_DIR)) return projects;
  const entries = fs.readdirSync(PROJECTS_DIR);
  for (const entry of entries) {
    const projPath = path.join(PROJECTS_DIR, entry);
    if (!fs.statSync(projPath).isDirectory()) continue;
    const manifestPath = path.join(projPath, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      projects.push({
        id: entry,
        name: manifest.name || 'Untitled',
        skillId: manifest.skillId || null,
        designSystemId: manifest.designSystemId || null,
        createdAt: manifest.createdAt || Date.now(),
        updatedAt: manifest.updatedAt || Date.now(),
        pendingPrompt: manifest.pendingPrompt || null,
        metadata: manifest.metadata || {}
      });
    } catch {
      // Skip corrupted manifests
    }
  }
  return projects.sort((a, b) => b.updatedAt - a.updatedAt);
}

// --- Helper: Get project files ---
function getProjectFiles(projectId) {
  const projPath = path.join(PROJECTS_DIR, projectId);
  if (!fs.existsSync(projPath)) return [];
  
  function scanDir(dir, baseDir = dir) {
    let results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(baseDir, fullPath);
      
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        results = results.concat(scanDir(fullPath, baseDir));
      } else {
        const stat = fs.statSync(fullPath);
        results.push({
          name: relativePath,
          path: fullPath,
          size: stat.size,
          mtime: stat.mtimeMs,
          kind: 'file'
        });
      }
    }
    return results;
  }
  
  return scanDir(projPath);
}

// --- Helper: Read project file content ---
function readProjectFile(projectId, filePath) {
  const projPath = path.join(PROJECTS_DIR, projectId);
  const fullPath = path.join(projPath, filePath);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, 'utf-8');
}

// --- API Routes ---

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0' });
});

// Get settings
app.get('/api/settings', (req, res) => {
  const settings = loadSettings();
  // Don't send the API key back to the client for security
  res.json({ ...settings, apiKey: '' });
});

// Update settings
app.post('/api/settings', (req, res) => {
  const current = loadSettings();
  const updated = { ...current, ...req.body };
  saveSettings(updated);
  res.json({ ...updated, apiKey: '' });
});

// List skills
app.get('/api/skills', (req, res) => {
  const skills = loadSkills();
  res.json({ skills });
});

// Get skill details
app.get('/api/skills/:id', (req, res) => {
  const skills = loadSkills();
  const skill = skills.find(s => s.id === req.params.id);
  if (!skill) return res.status(404).json({ error: 'Skill not found' });
  res.json(skill);
});

// Create/import skill
app.post('/api/skills/import', (req, res) => {
  const { name, description, body, triggers } = req.body;
  if (!name || !body) {
    return res.status(400).json({ error: 'Name and body are required' });
  }
  
  const skillDir = path.join(SKILLS_DIR, name);
  if (fs.existsSync(skillDir)) {
    return res.status(409).json({ error: 'Skill already exists' });
  }
  
  fs.mkdirSync(skillDir, { recursive: true });
  let frontmatter = `---\nname: ${name}\n`;
  if (description) frontmatter += `description: ${description}\n`;
  if (triggers && triggers.length) frontmatter += `triggers: [${triggers.join(', ')}]\n`;
  frontmatter += `---\n\n`;
  
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), frontmatter + body);
  
  const skill = { id: name, name, description: description || '', triggers: triggers || [], body };
  res.json({ skill });
});

// Update skill
app.put('/api/skills/:id', (req, res) => {
  const skillDir = path.join(SKILLS_DIR, req.params.id);
  if (!fs.existsSync(skillDir)) {
    return res.status(404).json({ error: 'Skill not found' });
  }
  
  const { name, description, body, triggers } = req.body;
  let frontmatter = `---\n`;
  if (name) frontmatter += `name: ${name}\n`;
  else frontmatter += `name: ${req.params.id}\n`;
  if (description) frontmatter += `description: ${description}\n`;
  if (triggers && triggers.length) frontmatter += `triggers: [${triggers.join(', ')}]\n`;
  frontmatter += `---\n\n`;
  
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), frontmatter + body);
  res.json({ ok: true });
});

// Delete skill
app.delete('/api/skills/:id', (req, res) => {
  const skillDir = path.join(SKILLS_DIR, req.params.id);
  if (!fs.existsSync(skillDir)) {
    return res.status(404).json({ error: 'Skill not found' });
  }
  
  fs.rmSync(skillDir, { recursive: true, force: true });
  res.json({ ok: true });
});

// List design systems
app.get('/api/design-systems', (req, res) => {
  const systems = loadDesignSystems();
  res.json({ designSystems: systems });
});

// Get design system details
app.get('/api/design-systems/:id', (req, res) => {
  const systems = loadDesignSystems();
  const system = systems.find(s => s.id === req.params.id);
  if (!system) return res.status(404).json({ error: 'Design system not found' });
  res.json(system);
});

// List projects
app.get('/api/projects', (req, res) => {
  const projects = loadProjects();
  res.json({ projects });
});

// Create project
app.post('/api/projects', (req, res) => {
  const { name, skillId, designSystemId, pendingPrompt, metadata } = req.body;
  const projectId = uuidv4();
  const projPath = path.join(PROJECTS_DIR, projectId);
  
  fs.mkdirSync(projPath, { recursive: true });
  
  const manifest = {
    id: projectId,
    name: name || 'Untitled Project',
    skillId: skillId || null,
    designSystemId: designSystemId || null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    pendingPrompt: pendingPrompt || null,
    metadata: metadata || {}
  };
  
  fs.writeFileSync(path.join(projPath, 'manifest.json'), JSON.stringify(manifest, null, 2));
  res.json({ project: manifest });
});

// Get project details
app.get('/api/projects/:id', (req, res) => {
  const projects = loadProjects();
  const project = projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(project);
});

// Update project
app.patch('/api/projects/:id', (req, res) => {
  const projPath = path.join(PROJECTS_DIR, req.params.id);
  const manifestPath = path.join(projPath, 'manifest.json');
  
  if (!fs.existsSync(manifestPath)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const updated = { ...manifest, ...req.body, updatedAt: Date.now() };
  fs.writeFileSync(manifestPath, JSON.stringify(updated, null, 2));
  res.json(updated);
});

// Delete project
app.delete('/api/projects/:id', (req, res) => {
  const projPath = path.join(PROJECTS_DIR, req.params.id);
  if (!fs.existsSync(projPath)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  
  fs.rmSync(projPath, { recursive: true, force: true });
  res.json({ ok: true });
});

// Get project files
app.get('/api/projects/:id/files', (req, res) => {
  const files = getProjectFiles(req.params.id);
  res.json({ files });
});

// Read project file
app.get('/api/projects/:id/files/:filePath(*)', (req, res) => {
  const content = readProjectFile(req.params.id, req.params.filePath);
  if (!content) return res.status(404).json({ error: 'File not found' });
  res.json({ content });
});

// Write project file
app.post('/api/projects/:id/files', (req, res) => {
  const { filePath, content } = req.body;
  if (!filePath || content === undefined) {
    return res.status(400).json({ error: 'filePath and content are required' });
  }
  
  const projPath = path.join(PROJECTS_DIR, req.params.id);
  const fullPath = path.join(projPath, filePath);
  
  // Ensure parent directories exist
  const dir = path.dirname(fullPath);
  fs.mkdirSync(dir, { recursive: true });
  
  fs.writeFileSync(fullPath, content);
  res.json({ ok: true, path: filePath });
});

// Get project conversations (simplified - just one conversation per project for now)
app.get('/api/projects/:id/conversations', (req, res) => {
  const projPath = path.join(PROJECTS_DIR, req.params.id);
  const transcriptPath = path.join(projPath, '.transcript.jsonl');
  
  if (!fs.existsSync(transcriptPath)) {
    // Create initial empty transcript
    fs.writeFileSync(transcriptPath, '');
    return res.json({ conversations: [{ id: 'main', title: 'Conversation', createdAt: Date.now(), updatedAt: Date.now() }] });
  }
  
  const lines = fs.readFileSync(transcriptPath, 'utf-8').trim().split('\n').filter(l => l.trim());
  const messages = lines.map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
  
  res.json({
    conversations: [{ id: 'main', title: 'Conversation', createdAt: Date.now(), updatedAt: Date.now() }],
    messages: messages
  });
});

// Save message to conversation
app.post('/api/projects/:id/conversations/:convId/messages', (req, res) => {
  const projPath = path.join(PROJECTS_DIR, req.params.id);
  const transcriptPath = path.join(projPath, '.transcript.jsonl');
  
  const message = {
    id: req.body.id || uuidv4(),
    role: req.body.role,
    content: req.body.content,
    createdAt: req.body.createdAt || Date.now()
  };
  
  fs.appendFileSync(transcriptPath, JSON.stringify(message) + '\n');
  res.json({ message });
});

// Chat endpoint - supports Anthropic, OpenAI, and Ollama
app.post('/api/chat', async (req, res) => {
  const settings = loadSettings();
  const { messages, model, maxTokens, skillBody, designSystemBody } = req.body;
  
  if (!messages || messages.length === 0) {
    return res.status(400).json({ error: 'Messages are required' });
  }
  
  // Build system prompt
  let systemPrompt = '';
  if (skillBody) {
    systemPrompt += skillBody + '\n\n';
  }
  if (designSystemBody) {
    systemPrompt += designSystemBody + '\n\n';
  }
  
  const isEditRequest = req.body.elementContext && req.body.elementContext.html;
  
  if (isEditRequest) {
    // Edit mode: only modify the selected element
    systemPrompt += `You are a precise code editor. The user has selected a specific HTML element and wants you to modify ONLY that element or its immediate parent container.

CRITICAL RULES FOR EDITS:
1. You MUST output the COMPLETE, FULL HTML file — do NOT output just the changed snippet
2. Find the selected element in the full file and apply ONLY the requested change to it
3. Leave EVERYTHING ELSE exactly as-is — no reformatting, no reordering, no changes to unrelated elements
4. The selected element HTML is provided in <selected-element> tags
5. The user's edit instruction is in <edit-instruction> tags
6. Wrap your output in <artifact> tags

Output format:
<artifact type="text/html" identifier="index.html" title="My Page">
[COMPLETE HTML FILE with ONLY the requested change applied]
</artifact>
`;
  } else {
    // Full generation mode
    systemPrompt += `You are a helpful assistant that generates code and design artifacts. When you produce HTML, React, or other complete files, wrap them in <artifact> tags like this:

<artifact type="text/html" identifier="index.html" title="My Page">
<!DOCTYPE html>
<html>
<head><title>My Page</title></head>
<body>
<h1>Hello World</h1>
</body>
</html>
</artifact>

Only output one artifact per response. Keep artifacts complete and self-contained.`;
  }
  
  // Add element context for edit requests
  let enhancedMessages = [...messages.map(m => ({ role: m.role, content: m.content }))];
  if (isEditRequest) {
    const { elementContext, userInstruction } = req.body;
    const editMessage = `I need you to edit a specific part of this HTML file.

<full-file>
${elementContext.fullHtml}
</full-file>

<selected-element>
${elementContext.html}
</selected-element>

<element-info>
Tag: ${elementContext.tagName}
Classes: ${elementContext.classes || 'none'}
ID: ${elementContext.id || 'none'}
Parent: ${elementContext.parentTag || 'unknown'}
Position: ${elementContext.position || 'unknown'}
</element-info>

<edit-instruction>
${userInstruction || elementContext.editPrompt}
</edit-instruction>

Apply ONLY the requested change to the selected element. Keep everything else identical.`;
    
    enhancedMessages.push({ role: 'user', content: editMessage });
  }
  
  // --- LLAMA.CPP SERVER (local, OpenAI-compatible API) ---
  if (settings.apiProvider === 'llamacpp') {
    const llamaUrl = settings.llamaCppUrl || 'http://localhost:8080';
    const apiKey = settings.llamaCppKey || '';
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      
      const response = await fetch(`${llamaUrl}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: model || settings.model || '',
          messages: [
            { role: 'system', content: systemPrompt },
            ...enhancedMessages
          ],
          stream: true,
          max_tokens: maxTokens || settings.maxTokens || 4096
        })
      });
      
      if (!response.ok) {
        const error = await response.text();
        return res.status(response.status).json({ error: `Llama.cpp server error: ${error}` });
      }
      
      // Stream the response (OpenAI-compatible SSE format)
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      
      const stream = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const data = line.slice(6);
              if (data === '[DONE]') {
                res.write('data: [DONE]\n\n');
                res.end();
                return;
              }
              
              try {
                const parsed = JSON.parse(data);
                // OpenAI streaming format: choices[0].delta.content
                const delta = parsed.choices?.[0]?.delta?.content || '';
                if (delta) {
                  res.write(`data: ${JSON.stringify({ type: 'content', delta })}\n\n`);
                }
              } catch {
                // Skip malformed JSON
              }
            }
          }
        } catch (err) {
          res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
          res.end();
        }
      };
      
      stream();
      return;
    } catch (err) {
      return res.status(500).json({ error: `Failed to connect to Llama.cpp server at ${llamaUrl}: ${err.message}` });
    }
  }
  
  // --- OLLAMA (local) ---
  if (settings.apiProvider === 'ollama') {
    const ollamaUrl = settings.ollamaUrl || 'http://localhost:11434';
    try {
      const response = await fetch(`${ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model || settings.model || 'llama3.2',
          messages: enhancedMessages,
          stream: true,
          options: {
            num_predict: maxTokens || settings.maxTokens || 4096
          }
        })
      });
      
      if (!response.ok) {
        const error = await response.text();
        return res.status(response.status).json({ error: `Ollama API error: ${error}` });
      }
      
      // Stream the Ollama response
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      
      const stream = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const parsed = JSON.parse(line);
                const delta = parsed.message?.content || '';
                if (delta) {
                  res.write(`data: ${JSON.stringify({ type: 'content', delta })}\n\n`);
                }
                if (parsed.done) {
                  res.write('data: [DONE]\n\n');
                  res.end();
                  return;
                }
              } catch {
                // Skip malformed JSON
              }
            }
          }
        } catch (err) {
          res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
          res.end();
        }
      };
      
      stream();
      return;
    } catch (err) {
      return res.status(500).json({ error: `Failed to connect to Ollama at ${ollamaUrl}: ${err.message}` });
    }
  }
  
  // --- ANTHROPIC ---
  if (!settings.apiKey) {
    return res.status(401).json({ error: 'API key not configured. Please set it in Settings.' });
  }
  
  // Build Anthropic messages with proper content block handling (supports text + images)
  const anthropicMessages = messages.map(m => {
    let content = m.content;
    
    // If content is already an array of content blocks (text + images), use as-is
    if (Array.isArray(content)) {
      return { role: m.role === 'assistant' ? 'assistant' : 'user', content };
    }
    
    // If content is a string, wrap in text block
    return {
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: [{ type: 'text', text: content }]
    };
  });
  
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': settings.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: model || settings.model || 'claude-sonnet-4-20250514',
        max_tokens: maxTokens || settings.maxTokens || 8192,
        system: systemPrompt,
        messages: anthropicMessages.map(m => {
          // Handle content blocks (text + images) properly for Anthropic API
          if (Array.isArray(m.content)) {
            return m; // Already in correct format
          }
          // String content - wrap as text block
          return {
            role: m.role,
            content: [{ type: 'text', text: m.content }]
          };
        }),
        stream: true
      })
    });
    
    if (!response.ok) {
      const error = await response.text();
      return res.status(response.status).json({ error: `Anthropic API error: ${error}` });
    }
    
    // Stream the response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    
    const stream = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6);
            if (data === '[DONE]') {
              res.write('data: [DONE]\n\n');
              res.end();
              return;
            }
            
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === 'content_block_delta') {
                const delta = parsed.delta?.text || '';
                if (delta) {
                  res.write(`data: ${JSON.stringify({ type: 'content', delta })}\n\n`);
                }
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      } catch (err) {
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
      }
    };
    
    stream();
  } catch (err) {
    res.status(500).json({ error: `Failed to connect to Anthropic API: ${err.message}` });
  }
});

// List agents (MCP servers)
app.get('/api/agents', (req, res) => {
  // For now, return a simple list. In the full version, this would detect local MCP servers.
  res.json({
    agents: [
      { id: 'claude-code', name: 'Claude Code', available: true, description: 'Local Claude Code CLI agent' },
      { id: 'codex', name: 'OpenAI Codex', available: false, description: 'OpenAI Codex CLI agent' }
    ]
  });
});

// Memory extraction (simplified)
app.post('/api/memory/extract', (req, res) => {
  // For now, just acknowledge. Full implementation would use LLM to extract facts.
  res.json({ ok: true });
});

// Memory system prompt
app.get('/api/memory/system-prompt', (req, res) => {
  // Check for user memory file
  const memoryFile = path.join(MEMORY_DIR, 'MEMORY.md');
  if (!fs.existsSync(memoryFile)) {
    return res.json({ body: '' });
  }
  
  const content = fs.readFileSync(memoryFile, 'utf-8');
  res.json({ body: content });
});

// --- Serve frontend ---
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Start server ---
app.listen(PORT, () => {
  console.log(`Open Design Lite is running at http://localhost:${PORT}`);
  exec(`start http://localhost:${PORT}`);
});
