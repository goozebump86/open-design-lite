const fs = require('fs');
const file = 'c:/Users/gooze/Downloads/open-design-lite/public/index.html';
const content = fs.readFileSync(file, 'utf8');

const startMarker = '    // ============================================================\n    // FILE WORKSPACE (Preview + File Explorer)\n    // ============================================================';
const endMarker = '    // ============================================================\n    // ENTRY VIEW\n    // ============================================================';

const startIndex = content.indexOf(startMarker);
const endIndex = content.indexOf(endMarker);

if (startIndex === -1 || endIndex === -1) {
  console.log('Markers not found', startIndex, endIndex);
  process.exit(1);
}

const replacement = `    // ============================================================
    // PROJECT VIEW (main workspace)
    // ============================================================
    function ProjectView({ project, config, onBack }) {
      const [messages, setMessages] = useState([]);
      const [streaming, setStreaming] = useState(false);
      const [artifactHtml, setArtifactHtml] = useState(null);
      const [breakpoint, setBreakpoint] = useState('desktop');
      const [selectedElement, setSelectedElement] = useState(null);
      const [timer, setTimer] = useState(0);
      
      const iframeRef = useRef(null);

      useEffect(() => {
        let interval;
        if (streaming) {
          setTimer(0);
          interval = setInterval(() => setTimer(t => t + 1), 1000);
        }
        return () => clearInterval(interval);
      }, [streaming]);

      const handleIframeLoad = () => {
        const iframeDoc = iframeRef.current?.contentDocument;
        if (!iframeDoc) return;

        if (!iframeDoc.getElementById('od-selection-styles')) {
          const style = iframeDoc.createElement('style');
          style.id = 'od-selection-styles';
          style.innerHTML = \`
            .od-hovered { outline: 2px dashed rgba(59, 130, 246, 0.8) !important; outline-offset: -2px !important; cursor: pointer !important; }
            .od-selected { outline: 2px solid rgb(59, 130, 246) !important; outline-offset: -2px !important; }
          \`;
          iframeDoc.head.appendChild(style);
        }

        const handleMouseOver = (e) => {
          e.stopPropagation();
          if (['html', 'body'].includes(e.target.tagName.toLowerCase())) return;
          e.target.classList.add('od-hovered');
        };

        const handleMouseOut = (e) => {
          e.target.classList.remove('od-hovered');
        };

        const handleClick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          const target = e.target;
          
          if (['html', 'body'].includes(target.tagName.toLowerCase())) {
            iframeDoc.querySelectorAll('.od-selected').forEach(el => el.classList.remove('od-selected'));
            setSelectedElement(null);
            return;
          }
          
          iframeDoc.querySelectorAll('.od-selected').forEach(el => el.classList.remove('od-selected'));
          target.classList.add('od-selected');
          
          const clone = target.cloneNode(true);
          clone.classList.remove('od-selected', 'od-hovered');
          if (clone.classList.length === 0) clone.removeAttribute('class');
          
          const fullDocClone = iframeDoc.documentElement.cloneNode(true);
          fullDocClone.querySelectorAll('.od-selected, .od-hovered').forEach(el => {
            el.classList.remove('od-selected', 'od-hovered');
            if (el.classList.length === 0) el.removeAttribute('class');
          });

          const computed = iframeRef.current?.contentWindow?.getComputedStyle(target);
          
          setSelectedElement({
            html: clone.outerHTML,
            tagName: target.tagName.toLowerCase(),
            classes: clone.className || '',
            id: target.id || '',
            parentTag: target.parentElement?.tagName?.toLowerCase() || '',
            fullHtml: fullDocClone.outerHTML,
            ref: target,
            styles: {
              fontFamily: target.style.fontFamily || '',
              fontSize: target.style.fontSize ? target.style.fontSize.replace('px', '') : '',
              fontWeight: target.style.fontWeight || '',
              color: target.style.color || '',
              textAlign: target.style.textAlign || '',
              lineHeight: target.style.lineHeight || '',
              letterSpacing: target.style.letterSpacing || '',
              width: target.style.width || '',
              height: target.style.height || '',
              gap: target.style.gap || '',
              flexDirection: target.style.flexDirection || '',
              justifyContent: target.style.justifyContent || '',
              alignItems: target.style.alignItems || '',
              backgroundColor: target.style.backgroundColor || '',
              paddingTop: target.style.paddingTop ? target.style.paddingTop.replace('px', '') : '',
              paddingRight: target.style.paddingRight ? target.style.paddingRight.replace('px', '') : '',
              paddingBottom: target.style.paddingBottom ? target.style.paddingBottom.replace('px', '') : '',
              paddingLeft: target.style.paddingLeft ? target.style.paddingLeft.replace('px', '') : '',
              marginTop: target.style.marginTop ? target.style.marginTop.replace('px', '') : '',
              marginRight: target.style.marginRight ? target.style.marginRight.replace('px', '') : '',
              marginBottom: target.style.marginBottom ? target.style.marginBottom.replace('px', '') : '',
              marginLeft: target.style.marginLeft ? target.style.marginLeft.replace('px', '') : '',
              borderWidth: target.style.borderWidth ? target.style.borderWidth.replace('px', '') : '',
              borderColor: target.style.borderColor || '',
              borderStyle: target.style.borderStyle || '',
              borderRadius: target.style.borderRadius ? target.style.borderRadius.replace('px', '') : '',
            }
          });
        };

        iframeDoc.addEventListener('mouseover', handleMouseOver);
        iframeDoc.addEventListener('mouseout', handleMouseOut);
        iframeDoc.addEventListener('click', handleClick);
      };

      const handleUpdateStyle = (prop, value) => {
        if (!selectedElement || !selectedElement.ref) return;
        selectedElement.ref.style[prop] = value;
        setSelectedElement({...selectedElement, styles: {...selectedElement.styles, [prop]: value}});
        
        const iframeDoc = iframeRef.current?.contentDocument;
        if (iframeDoc) {
          const fullDocClone = iframeDoc.documentElement.cloneNode(true);
          fullDocClone.querySelectorAll('.od-selected, .od-hovered').forEach(el => {
            el.classList.remove('od-selected', 'od-hovered');
            if (el.classList.length === 0) el.removeAttribute('class');
          });
          setArtifactHtml(fullDocClone.outerHTML);
        }
      };

      const handleSend = useCallback(async (text, elementContext = null) => {
        const newMsgs = [...messages, { role: 'user', content: text }];
        setMessages(newMsgs);
        setStreaming(true);
        if (!elementContext) setArtifactHtml(null);

        try {
          const payload = {
            messages: newMsgs,
            model: config.model,
            maxTokens: config.maxTokens,
            skillBody: '',
          };

          if (elementContext) {
            payload.elementContext = elementContext;
            payload.userInstruction = text;
          }

          const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

          if (!response.ok) {
            setStreaming(false);
            return;
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let fullResponseText = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\\n');

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const data = line.slice(6);
              if (data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);
                if (parsed.type === 'content' && parsed.delta) {
                  fullResponseText += parsed.delta;
                }
              } catch {}
            }
          }

          const artifactMatch = fullResponseText.match(/<artifact[^>]*>([\\s\\S]*?)<\\/artifact>/);
          if (artifactMatch) {
            setArtifactHtml(artifactMatch[1]);
          }
          setStreaming(false);
        } catch (err) {
          setStreaming(false);
        }
      }, [messages, config]);

      const mins = Math.floor(timer / 60);
      const secs = timer % 60;
      const timeStr = \`\${mins}m \${secs}s\`;

      return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'system-ui, sans-serif' }}>
          {/* Top Navbar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', borderBottom: '1px solid #e5e7eb', background: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 0-10 10"/></svg>
                Open Design
              </div>
              <div style={{ color: '#9ca3af', cursor: 'pointer' }} onClick={onBack}>←</div>
              <div style={{ fontWeight: '500' }}>{project.name}</div>
              <div style={{ fontSize: '12px', color: '#6b7280', background: '#f3f4f6', padding: '2px 6px', borderRadius: '4px' }}>TARGETS Responsive web</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button style={{ padding: '6px 12px', border: '1px solid #e5e7eb', borderRadius: '6px', background: '#fff', fontSize: '13px' }}>Present ⌄</button>
              <button style={{ padding: '6px 12px', border: 'none', borderRadius: '6px', background: '#000', color: '#fff', fontSize: '13px' }}>Share ⌄</button>
            </div>
          </div>

          <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            {/* Left Pane: Code & Chat */}
            <div style={{ width: '300px', display: 'flex', flexDirection: 'column', borderRight: '1px solid #e5e7eb', background: '#fff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px', borderBottom: '1px solid #e5e7eb' }}>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#6b7280' }}>+</button>
                  <button style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#6b7280' }}>{'<'}</button>
                </div>
              </div>
              <div style={{ flex: 1, overflow: 'auto', padding: '16px', fontSize: '11px', fontFamily: 'monospace', whiteSpace: 'pre-wrap', color: '#374151', wordBreak: 'break-all' }}>
                {artifactHtml || '<!-- No code generated yet -->'}
              </div>
              <div style={{ padding: '16px', borderTop: '1px solid #e5e7eb' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '12px', color: '#6b7280' }}>
                  {streaming ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div className="spinner" style={{ width: '8px', height: '8px', border: '2px solid #e5e7eb', borderTopColor: '#000', borderRadius: '50%', animation: 'od-spin 1s linear infinite' }} />
                      Generating... {timeStr}
                    </div>
                  ) : (
                    <div>• Done {timeStr}</div>
                  )}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <span style={{ cursor: 'pointer' }}>👍</span><span style={{ cursor: 'pointer' }}>👎</span>
                  </div>
                </div>
                <ChatComposer streaming={streaming} sendDisabled={streaming} onSend={handleSend} onStop={() => setStreaming(false)} skills={[]} />
              </div>
            </div>

            {/* Middle Pane: Preview */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#f9fafb' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', background: '#fff', borderBottom: '1px solid #e5e7eb' }}>
                <div style={{ display: 'flex', gap: '16px', fontSize: '13px' }}>
                  <button style={{ border: 'none', background: 'transparent', fontWeight: 'bold', borderBottom: '2px solid #000', paddingBottom: '4px', cursor: 'pointer' }}>Preview</button>
                  <button style={{ border: 'none', background: 'transparent', color: '#6b7280', cursor: 'pointer' }}>Source</button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '13px' }}>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button style={{ border: 'none', background: 'transparent', color: '#6b7280', cursor: 'pointer' }}>Tweaks</button>
                    <button style={{ border: 'none', background: '#fef3c7', color: '#d97706', padding: '2px 8px', borderRadius: '4px', cursor: 'pointer' }}>Edit</button>
                    <button style={{ border: 'none', background: 'transparent', color: '#6b7280', cursor: 'pointer' }}>Draw</button>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', borderLeft: '1px solid #e5e7eb', borderRight: '1px solid #e5e7eb', padding: '0 16px' }}>
                    <button onClick={() => setBreakpoint('desktop')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: breakpoint === 'desktop' ? 'bold' : 'normal' }}>Desktop</button>
                    <button onClick={() => setBreakpoint('tablet')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: breakpoint === 'tablet' ? 'bold' : 'normal' }}>Tablet</button>
                    <button onClick={() => setBreakpoint('mobile')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: breakpoint === 'mobile' ? 'bold' : 'normal' }}>Mobile</button>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#6b7280' }}>-</button>
                    <span>100%</span>
                    <button style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#6b7280' }}>+</button>
                  </div>
                </div>
              </div>
              <div style={{ flex: 1, padding: '32px', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', overflow: 'auto' }}>
                {artifactHtml ? (
                  <div style={{ background: '#fff', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', width: breakpoint === 'mobile' ? '375px' : breakpoint === 'tablet' ? '768px' : '100%', height: '100%', transition: 'width 0.3s' }}>
                    <iframe ref={iframeRef} srcDoc={artifactHtml} style={{ width: '100%', height: '100%', border: 'none' }} onLoad={handleIframeLoad} />
                  </div>
                ) : (
                  <div style={{ color: '#9ca3af', marginTop: '40px' }}>No preview available</div>
                )}
              </div>
            </div>

            {/* Right Pane: Properties */}
            <div style={{ width: '280px', display: 'flex', flexDirection: 'column', borderLeft: '1px solid #e5e7eb', background: '#fff', fontSize: '11px', overflowY: 'auto' }}>
              <div style={{ padding: '16px' }}>
                
                {!selectedElement ? (
                  <div style={{ marginBottom: '24px' }}>
                    <div style={{ fontWeight: 'bold', color: '#9ca3af', marginBottom: '12px', letterSpacing: '1px', textTransform: 'uppercase' }}>Page</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '8px' }}>
                       <div style={{ color: '#6b7280', flex: 1 }}>Background <input type="checkbox" /></div>
                       <input type="text" style={{ flex: 1, padding: '4px', border: '1px solid #e5e7eb', borderRadius: '4px' }} defaultValue="#FFFFFF" />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '8px' }}>
                       <div style={{ color: '#6b7280', flex: 1 }}>Font</div>
                       <select style={{ flex: 1, padding: '4px', border: '1px solid #e5e7eb', borderRadius: '4px' }}>
                         <option>Space Grotesk</option>
                         <option>Inter</option>
                         <option>Roboto</option>
                       </select>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '8px' }}>
                       <div style={{ color: '#6b7280', flex: 1 }}>Base size</div>
                       <div style={{ display: 'flex', flex: 1, border: '1px solid #e5e7eb', borderRadius: '4px', padding: '2px 4px' }}>
                         <input style={{ width: '100%', border: 'none', outline: 'none' }} placeholder="16" />
                         <span style={{ color: '#9ca3af' }}>px</span>
                       </div>
                    </div>
                  </div>
                ) : (
                  <>
                  {/* TYPOGRAPHY */}
                  <div style={{ marginBottom: '24px' }}>
                    <div style={{ fontWeight: 'bold', color: '#9ca3af', marginBottom: '12px', letterSpacing: '1px', textTransform: 'uppercase' }}>Typography</div>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                      <div style={{ flex: 2 }}>
                        <div style={{ color: '#6b7280', marginBottom: '4px' }}>Font</div>
                        <select style={{ width: '100%', padding: '4px', border: '1px solid #e5e7eb', borderRadius: '4px' }} value={selectedElement?.styles?.fontFamily || 'inherit'} onChange={e => handleUpdateStyle('fontFamily', e.target.value)}>
                          <option value="inherit">inherit</option>
                          <option value="sans-serif">sans-serif</option>
                          <option value="serif">serif</option>
                          <option value="monospace">monospace</option>
                        </select>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: '#6b7280', marginBottom: '4px' }}>Size</div>
                        <div style={{ display: 'flex', border: '1px solid #e5e7eb', borderRadius: '4px', padding: '2px 4px' }}>
                          <input style={{ width: '100%', border: 'none', outline: 'none' }} value={selectedElement?.styles?.fontSize || ''} onChange={e => handleUpdateStyle('fontSize', e.target.value ? \`\${e.target.value}px\` : '')} />
                          <span style={{ color: '#9ca3af' }}>px</span>
                        </div>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: '#6b7280', marginBottom: '4px' }}>Weight</div>
                        <select style={{ width: '100%', padding: '4px', border: '1px solid #e5e7eb', borderRadius: '4px' }} value={selectedElement?.styles?.fontWeight || '--'} onChange={e => handleUpdateStyle('fontWeight', e.target.value)}>
                          <option value="--">--</option>
                          <option value="normal">normal</option>
                          <option value="bold">bold</option>
                        </select>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: '#6b7280', marginBottom: '4px' }}>Color</div>
                        <input type="text" style={{ width: '100%', padding: '4px', border: '1px solid #e5e7eb', borderRadius: '4px' }} value={selectedElement?.styles?.color || ''} onChange={e => handleUpdateStyle('color', e.target.value)} placeholder="#000000" />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: '#6b7280', marginBottom: '4px' }}>Align</div>
                        <select style={{ width: '100%', padding: '4px', border: '1px solid #e5e7eb', borderRadius: '4px' }} value={selectedElement?.styles?.textAlign || '--'} onChange={e => handleUpdateStyle('textAlign', e.target.value)}>
                          <option value="--">--</option>
                          <option value="left">Left</option>
                          <option value="center">Center</option>
                          <option value="right">Right</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* LAYOUT */}
                  <div style={{ marginBottom: '24px' }}>
                    <div style={{ fontWeight: 'bold', color: '#9ca3af', marginBottom: '12px', letterSpacing: '1px', textTransform: 'uppercase' }}>Layout</div>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: '#6b7280', marginBottom: '4px' }}>Gap</div>
                        <div style={{ display: 'flex', border: '1px solid #e5e7eb', borderRadius: '4px', padding: '2px 4px' }}>
                          <input style={{ width: '100%', border: 'none', outline: 'none' }} value={selectedElement?.styles?.gap || ''} onChange={e => handleUpdateStyle('gap', e.target.value ? \`\${e.target.value}px\` : '')} />
                          <span style={{ color: '#9ca3af' }}>px</span>
                        </div>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: '#6b7280', marginBottom: '4px' }}>Direction</div>
                        <select style={{ width: '100%', padding: '4px', border: '1px solid #e5e7eb', borderRadius: '4px' }} value={selectedElement?.styles?.flexDirection || '--'} onChange={e => handleUpdateStyle('flexDirection', e.target.value)}>
                          <option value="--">--</option>
                          <option value="row">Row</option>
                          <option value="column">Col</option>
                        </select>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: '#6b7280', marginBottom: '4px' }}>Justify</div>
                        <select style={{ width: '100%', padding: '4px', border: '1px solid #e5e7eb', borderRadius: '4px' }} value={selectedElement?.styles?.justifyContent || '--'} onChange={e => handleUpdateStyle('justifyContent', e.target.value)}>
                          <option value="--">--</option>
                          <option value="flex-start">Start</option>
                          <option value="center">Center</option>
                          <option value="space-between">Space</option>
                        </select>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: '#6b7280', marginBottom: '4px' }}>Align</div>
                        <select style={{ width: '100%', padding: '4px', border: '1px solid #e5e7eb', borderRadius: '4px' }} value={selectedElement?.styles?.alignItems || '--'} onChange={e => handleUpdateStyle('alignItems', e.target.value)}>
                          <option value="--">--</option>
                          <option value="flex-start">Start</option>
                          <option value="center">Center</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* SIZE */}
                  <div style={{ marginBottom: '24px' }}>
                    <div style={{ fontWeight: 'bold', color: '#9ca3af', marginBottom: '12px', letterSpacing: '1px', textTransform: 'uppercase' }}>Size</div>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: '#6b7280', marginBottom: '4px' }}>Width</div>
                        <div style={{ display: 'flex', border: '1px solid #e5e7eb', borderRadius: '4px', padding: '2px 4px' }}>
                          <input style={{ width: '100%', border: 'none', outline: 'none' }} value={selectedElement?.styles?.width || ''} onChange={e => handleUpdateStyle('width', e.target.value ? \`\${e.target.value}px\` : '')} />
                          <span style={{ color: '#9ca3af' }}>px</span>
                        </div>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: '#6b7280', marginBottom: '4px' }}>Height</div>
                        <div style={{ display: 'flex', border: '1px solid #e5e7eb', borderRadius: '4px', padding: '2px 4px' }}>
                          <input style={{ width: '100%', border: 'none', outline: 'none' }} value={selectedElement?.styles?.height || ''} onChange={e => handleUpdateStyle('height', e.target.value ? \`\${e.target.value}px\` : '')} />
                          <span style={{ color: '#9ca3af' }}>px</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* FILL */}
                  <div style={{ marginBottom: '24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                       <div style={{ fontWeight: 'bold', color: '#9ca3af', letterSpacing: '1px', textTransform: 'uppercase', width: '60px' }}>Fill</div>
                       <input type="text" style={{ flex: 1, padding: '4px', border: '1px solid #e5e7eb', borderRadius: '4px' }} value={selectedElement?.styles?.backgroundColor || ''} onChange={e => handleUpdateStyle('backgroundColor', e.target.value)} placeholder="#FFFFFF" />
                    </div>
                  </div>
                  
                  {/* PADDING */}
                  <div style={{ marginBottom: '24px' }}>
                    <div style={{ fontWeight: 'bold', color: '#9ca3af', marginBottom: '12px', letterSpacing: '1px', textTransform: 'uppercase' }}>Padding</div>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ color: '#6b7280', width: '12px' }}>T</span>
                        <input style={{ width: '100%', padding: '2px', border: '1px solid #e5e7eb', borderRadius: '4px' }} value={selectedElement?.styles?.paddingTop || ''} onChange={e => handleUpdateStyle('paddingTop', e.target.value ? \`\${e.target.value}px\` : '')} />
                      </div>
                      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ color: '#6b7280', width: '12px' }}>R</span>
                        <input style={{ width: '100%', padding: '2px', border: '1px solid #e5e7eb', borderRadius: '4px' }} value={selectedElement?.styles?.paddingRight || ''} onChange={e => handleUpdateStyle('paddingRight', e.target.value ? \`\${e.target.value}px\` : '')} />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ color: '#6b7280', width: '12px' }}>B</span>
                        <input style={{ width: '100%', padding: '2px', border: '1px solid #e5e7eb', borderRadius: '4px' }} value={selectedElement?.styles?.paddingBottom || ''} onChange={e => handleUpdateStyle('paddingBottom', e.target.value ? \`\${e.target.value}px\` : '')} />
                      </div>
                      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ color: '#6b7280', width: '12px' }}>L</span>
                        <input style={{ width: '100%', padding: '2px', border: '1px solid #e5e7eb', borderRadius: '4px' }} value={selectedElement?.styles?.paddingLeft || ''} onChange={e => handleUpdateStyle('paddingLeft', e.target.value ? \`\${e.target.value}px\` : '')} />
                      </div>
                    </div>
                  </div>

                  {/* MARGIN */}
                  <div style={{ marginBottom: '24px' }}>
                    <div style={{ fontWeight: 'bold', color: '#9ca3af', marginBottom: '12px', letterSpacing: '1px', textTransform: 'uppercase' }}>Margin</div>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ color: '#6b7280', width: '12px' }}>T</span>
                        <input style={{ width: '100%', padding: '2px', border: '1px solid #e5e7eb', borderRadius: '4px' }} value={selectedElement?.styles?.marginTop || ''} onChange={e => handleUpdateStyle('marginTop', e.target.value ? \`\${e.target.value}px\` : '')} />
                      </div>
                      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ color: '#6b7280', width: '12px' }}>R</span>
                        <input style={{ width: '100%', padding: '2px', border: '1px solid #e5e7eb', borderRadius: '4px' }} value={selectedElement?.styles?.marginRight || ''} onChange={e => handleUpdateStyle('marginRight', e.target.value ? \`\${e.target.value}px\` : '')} />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ color: '#6b7280', width: '12px' }}>B</span>
                        <input style={{ width: '100%', padding: '2px', border: '1px solid #e5e7eb', borderRadius: '4px' }} value={selectedElement?.styles?.marginBottom || ''} onChange={e => handleUpdateStyle('marginBottom', e.target.value ? \`\${e.target.value}px\` : '')} />
                      </div>
                      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ color: '#6b7280', width: '12px' }}>L</span>
                        <input style={{ width: '100%', padding: '2px', border: '1px solid #e5e7eb', borderRadius: '4px' }} value={selectedElement?.styles?.marginLeft || ''} onChange={e => handleUpdateStyle('marginLeft', e.target.value ? \`\${e.target.value}px\` : '')} />
                      </div>
                    </div>
                  </div>

                  {/* BORDER */}
                  <div style={{ marginBottom: '24px' }}>
                    <div style={{ fontWeight: 'bold', color: '#9ca3af', marginBottom: '12px', letterSpacing: '1px', textTransform: 'uppercase' }}>Border</div>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: '#6b7280', marginBottom: '4px' }}>Color</div>
                        <input type="text" style={{ width: '100%', padding: '4px', border: '1px solid #e5e7eb', borderRadius: '4px' }} value={selectedElement?.styles?.borderColor || ''} onChange={e => handleUpdateStyle('borderColor', e.target.value)} placeholder="#000000" />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: '#6b7280', marginBottom: '4px' }}>Width</div>
                        <input style={{ width: '100%', padding: '2px', border: '1px solid #e5e7eb', borderRadius: '4px' }} value={selectedElement?.styles?.borderWidth || ''} onChange={e => handleUpdateStyle('borderWidth', e.target.value ? \`\${e.target.value}px\` : '')} placeholder="px" />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                       <div style={{ flex: 1 }}>
                        <div style={{ color: '#6b7280', marginBottom: '4px' }}>Radius</div>
                        <input style={{ width: '100%', padding: '2px', border: '1px solid #e5e7eb', borderRadius: '4px' }} value={selectedElement?.styles?.borderRadius || ''} onChange={e => handleUpdateStyle('borderRadius', e.target.value ? \`\${e.target.value}px\` : '')} placeholder="px" />
                      </div>
                    </div>
                  </div>
                  </>
                )}

              </div>
            </div>
          </div>
        </div>
      );
    }
`;

const newContent = content.substring(0, startIndex) + replacement + '\n\n' + content.substring(endIndex);
fs.writeFileSync(file, newContent, 'utf8');
console.log('Successfully patched index.html');
