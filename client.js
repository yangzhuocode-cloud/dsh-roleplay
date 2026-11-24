window.__ModuleLoader__.load({
  id: 'dsh-roleplay',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useRef } = React;
    const base = '/api/quyubagu';
    const tabs = [['cards', '人设卡'], ['tone', '去八股'], ['memes', '梗百科']];
    const levels = ['关', '轻', '中', '强'];
    const toneOptions = [
      ['imitation', '贴近台词示例', ['最多 1 组，参考语气和句长', '最多 2 组，同时参考用词和反应', '最多 3 组，优先相近场景']],
      ['agency', '给玩家留行动空间', ['不替玩家说话或决定', '同时保留玩家的内心与关键反应', '推进到玩家能自己接话的位置']],
    ];

    async function request(path, data) {
      const response = await fetch(base + path, {
        headers: { 'x-quyubagu': '1', ...(data === undefined ? {} : { 'content-type': 'application/json' }) },
        credentials: 'same-origin',
        ...(data === undefined ? {} : { method: 'POST', body: JSON.stringify(data) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '操作失败');
      return result;
    }
    const query = value => encodeURIComponent(value);
    const blankCard = name => ({
      name, avatar: '', description: '', voice: '', roleplay: false, examples: [],
      scene: { description: '', rules: '', greetings: [], greetingIndex: 0, narration: true, examples: [] },
    });
    const blankTerm = () => ({ name: '', definition: '', aliases: [], usage: '', source: '' });
    const button = (label, onClick, props = {}) => h('button', { type: 'button', onClick, ...props }, label);
    const toggle = (label, value, onChange) => button(
      h(React.Fragment, null, h('span', { className: 'qyb-switch-track', 'aria-hidden': true }), label),
      () => onChange(!value), { role: 'switch', 'aria-checked': value, className: 'qyb-switch' },
    );
    const field = (label, value, onChange, placeholder, multiline = false, props = {}) => h('label', { className: 'qyb-field' },
      label, h(multiline ? 'textarea' : 'input', { value, placeholder, onChange: event => onChange(event.target.value), ...props }));
    const note = value => h('p', { className: 'qyb-note' }, value);
    function avatar(card) {
      return card.avatar ? h('img', { className: 'qyb-avatar', src: card.avatar, alt: '' })
        : h('span', { className: 'qyb-avatar qyb-initial', 'aria-hidden': true }, [...(card.name || '人')][0]);
    }
    function download(filename, value) {
      const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = filename.replace(/[\\/:*?"<>|]/g, '_') + '.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    async function readJson(file) {
      if (file.size > 8 * 1024 * 1024) throw new Error('JSON 文件最大 8 MB');
      try { return JSON.parse(await file.text()); }
      catch { throw new Error('JSON 文件格式不正确'); }
    }
    function useStatus() {
      const [message, setMessage] = useState('');
      const [error, setError] = useState(false);
      const [busy, setBusy] = useState(false);
      const inFlight = useRef(false);
      async function run(action) {
        if (inFlight.current) return;
        inFlight.current = true;
        setBusy(true);
        setMessage('');
        try {
          const result = await action();
          setError(false);
          if (typeof result === 'string') setMessage(result);
        } catch (cause) {
          setError(true);
          setMessage(cause.message);
        } finally {
          setBusy(false);
          inFlight.current = false;
        }
      }
      return { run, busy, feedback: message && h('p', { role: error ? 'alert' : 'status', className: error ? 'qyb-error' : '' }, message) };
    }
    function SettingsFields({ value, change, page, roleplay = true }) {
      if (page === 'memes') return h('div', { className: 'qyb-stack' },
        toggle('启用梗百科', value.memes, next => change({ memes: next })),
        value.memes && toggle('自动查梗', value.autoLookup, next => change({ autoLookup: next })),
        value.memes && note('自动查梗会在回复前提供相关词条。关闭预查后，模型仍可调用查询工具。'));
      return h('div', { className: 'qyb-stack' },
        toggle('启用去八股', value.tone, next => change({ tone: next })),
        value.tone && toggle('减少套话', Boolean(value.filler), next => change({ filler: next })),
        value.tone && toneOptions.filter(([key]) => roleplay || key !== 'agency').map(([key, label, hints]) =>
          h('label', { className: 'qyb-field', key },
            label, h('select', { value: value[key], onChange: event => change({ [key]: Number(event.target.value) }) },
              levels.map((level, i) => h('option', { key: level, value: i }, level))),
            value[key] > 0 && note(hints[value[key] - 1]))));
    }
    function TonePreview() {
      const [text, setText] = useState('');
      const [strength, setStrength] = useState('light');
      const [seed, setSeed] = useState('7');
      const [grammar, setGrammar] = useState(true);
      const [result, setResult] = useState(null);
      const status = useStatus();
      return h('section', { className: 'qyb-box qyb-stack', 'aria-label': '文本试改' },
        h('h3', null, '文本试改'),
        note('用原版规则试改已有文本。这里的档位只影响试改。'),
        field('原文', text, setText, '粘贴一段想试改的话', true, { maxLength: 12000 }),
        h('div', { className: 'qyb-row' },
          h('label', { className: 'qyb-field' }, '试改力度',
            h('select', { value: strength, onChange: event => setStrength(event.target.value) },
              ['off', 'light', 'normal', 'max'].map((value, i) => h('option', { key: value, value }, levels[i])))),
          field('随机种子', seed, setSeed, '7', false, { type: 'number', step: 1 }),
          toggle('启用语病层', grammar, setGrammar)),
        button('试改', () => status.run(async () => {
          setResult(null);
          const preview = await request('/tone/preview', { text, strength, seed: Number(seed), grammar });
          setResult(preview.text);
        }), { className: 'qyb-primary', disabled: status.busy || !text.trim() || seed === '' }),
        status.feedback,
        result !== null && h('label', { className: 'qyb-field' }, '试改结果',
          h('textarea', { value: result, readOnly: true })));
    }
    function AvatarEditor({ card, onChange, onError }) {
      const [image, setImage] = useState(null);
      const [position, setPosition] = useState({ x: 50, y: 50, zoom: 1 });
      const canvas = useRef(null);
      const picker = useRef(null);
      useEffect(() => {
        if (!image || !canvas.current) return;
        const size = Math.min(image.naturalWidth, image.naturalHeight) / position.zoom;
        const x = (image.naturalWidth - size) * position.x / 100;
        const y = (image.naturalHeight - size) * position.y / 100;
        const context = canvas.current.getContext('2d');
        context.clearRect(0, 0, 512, 512);
        context.drawImage(image, x, y, size, size, 0, 0, 512, 512);
      }, [image, position]);
      async function select(file) {
        try {
          if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('请选择 5 MB 以内的 JPG、PNG 或 WebP');
          const url = URL.createObjectURL(file);
          try {
            const next = new Image();
            next.src = url;
            await next.decode();
            if (next.naturalWidth * next.naturalHeight > 40_000_000) throw new Error('图片像素过大，请缩小后重试');
            setPosition({ x: 50, y: 50, zoom: 1 });
            setImage(next);
          } finally { URL.revokeObjectURL(url); }
        } catch (error) { onError(error.message); }
      }
      return h('div', { className: 'qyb-stack' },
        h('div', { className: 'qyb-row' }, avatar(card),
          h('input', { type: 'file', ref: picker, hidden: true, accept: 'image/png,image/jpeg,image/webp', onChange: event => {
            const [file] = event.target.files;
            if (file) void select(file);
            event.target.value = '';
          } }),
          button(card.avatar ? '更换头像' : '上传头像', () => picker.current.click()),
          card.avatar && button('移除头像', () => onChange('')),
          note('JPG、PNG 或 WebP，最多 5 MB，裁为正方形。')),
        image && h('div', { className: 'qyb-crop' }, h('canvas', { width: 512, height: 512, ref: canvas, 'aria-label': '头像裁剪预览' }),
          [['x', '横向位置', 0, 100, 1], ['y', '纵向位置', 0, 100, 1], ['zoom', '缩放', 1, 3, 0.01]]
            .map(([key, label, min, max, step]) => h('label', { key }, label, h('input', {
              type: 'range', min, max, step, value: position[key],
              onChange: event => setPosition({ ...position, [key]: Number(event.target.value) }),
            }))),
          button('使用裁剪结果', () => { onChange(canvas.current.toDataURL('image/png')); setImage(null); }),
          button('取消裁剪', () => setImage(null))));
    }
    function RepeatFields({ values, onChange, label, example, renderValue }) {
      function replace(i, value) { onChange(values.map((existing, j) => i === j ? value : existing)); }
      function move(i, direction) {
        const next = [...values];
        [next[i], next[i + direction]] = [next[i + direction], next[i]];
        onChange(next, { from: i, to: i + direction });
      }
      return h('div', { className: 'qyb-stack' }, h('strong', null, label),
        values.map((value, i) => h('div', { key: i, className: 'qyb-box' }, renderValue(value, next => replace(i, next), i),
          h('div', { className: 'qyb-row' },
            button('上移', () => move(i, -1), { disabled: i === 0 }),
            button('下移', () => move(i, 1), { disabled: i === values.length - 1 }),
            button('移除', () => onChange(values.filter((_, j) => j !== i), { removed: i }))))),
        button('添加' + label, () => onChange([...values, example]),
          { disabled: values.length >= (typeof example === 'string' ? 12 : 20) }));
    }
    function DialogueExamples({ roleplay = false, values, onChange }) {
      return h(RepeatFields, {
        values, onChange, label: roleplay ? '扮演示例' : '日常对话示例', example: { user: '', assistant: '' },
        renderValue: (value, change) => h('div', { className: 'qyb-stack' },
          field(roleplay ? '玩家台词' : '用户输入', value.user, user => change({ ...value, user }),
            roleplay ? '例：后门刚才响了一下。' : '例：我今天有点累。', true, { maxLength: 1000 }),
          field(roleplay ? '角色回复' : '角色日常回复', value.assistant, assistant => change({ ...value, assistant }),
            roleplay ? '例：*她摘下钥匙。*\n\n“我去开灯。你帮我看一下收银台？”' : '例：那先把包放下。今晚歇会儿。', true, { maxLength: 2000 })),
      });
    }
    function CardEditor({ record, onSave, onCancel }) {
      const [card, setCard] = useState(record.card);
      const [error, setError] = useState('');
      const status = useStatus();
      const update = (key, value) => setCard(current => ({ ...current, [key]: value }));
      const scene = (key, value) => setCard(current => ({ ...current, scene: { ...current.scene, [key]: value } }));
      const leave = action => {
        if (card === record.card || window.confirm('放弃未保存的改动？')) action();
      };
      const updateGreetings = (greetings, movement = {}) => setCard(current => {
        const { from, to, removed } = movement;
        let greetingIndex = current.scene.greetingIndex;
        if (from === greetingIndex) greetingIndex = to;
        else if (to === greetingIndex) greetingIndex = from;
        else if (removed === greetingIndex) greetingIndex = 0;
        else if (removed < greetingIndex) greetingIndex--;
        return { ...current, scene: { ...current.scene, greetings, greetingIndex } };
      });
      return h('div', { className: 'qyb-stack' },
        h('div', { className: 'qyb-row qyb-between' },
          h('h3', null, record.id ? card.name : '新建人设卡'),
          record.id && button('导出 JSON', () => download(record.card.name, {
            schema: record.schema, version: record.version, card: record.card,
          }))),
        h('section', { className: 'qyb-box qyb-stack', 'aria-label': '基础人设' },
          h('h3', null, '基础人设'),
          field('名称（必填） · 1–24 个可见字符', card.name, value => update('name', value), '新角色'),
          h(AvatarEditor, { card, onChange: value => update('avatar', value), onError: setError }),
          error && h('p', { role: 'alert', className: 'qyb-error' }, error),
          field('人设简介', card.description, value => update('description', value), '例：住在海边公寓，爱白饭，嘴硬心软。', true, { maxLength: 6000 }),
          field('性格与口吻', card.voice, value => update('voice', value), '例：话短，和熟人会斗嘴。关心别人时先做一件小事。', true, { maxLength: 4000 }),
          h(DialogueExamples, { values: card.examples, onChange: next => update('examples', next) })),
        h('details', { className: 'qyb-box qyb-roleplay' },
          h('summary', null, '角色扮演配置', h('span', { className: 'qyb-note' }, card.roleplay ? '已开启' : '已关闭')),
          h('div', { className: 'qyb-stack' },
          toggle('启用角色扮演', card.roleplay, value => update('roleplay', value)),
          note(card.roleplay ? '下面的内容都可选。填了开场白，角色会在新会话先发出这条消息。'
            : '目前只使用基础人设。关闭时会保留已填写的扮演内容。'),
          card.roleplay && h(React.Fragment, null,
            toggle('带动作与旁白', card.scene.narration, value => scene('narration', value)),
            note(card.scene.narration ? '可穿插独立的斜体动作段，角色台词使用中文双引号。'
              : '只说台词。旧开场白若还没分清动作和对白，由你先开口。'),
            field('场景与关系', card.scene.description, value => scene('description', value), '例：傍晚，你到隔壁大肥鱼家串门。', true, { maxLength: 6000 }),
            field('扮演约定', card.scene.rules, value => scene('rules', value), '例：玩家自己决定要说什么、做什么。', true, { maxLength: 4000 }),
            note('开场白和扮演示例用同一格式。动作写成 *动作*，台词用“……”括起，段落之间留一个空行。'),
            h(RepeatFields, { values: card.scene.greetings, onChange: updateGreetings, label: '开场白', example: '',
              renderValue: (value, change, i) => field('第 ' + (i + 1) + ' 条', value, change,
                '*大肥鱼把碗往旁边挪了挪。*\n\n“进来吧，锅里还有饭。”', true, { maxLength: 4000 }) }),
            card.scene.greetings.length > 1 && h('label', { className: 'qyb-field' }, '新会话使用的开场白',
              h('select', { value: card.scene.greetingIndex, onChange: event => scene('greetingIndex', Number(event.target.value)) },
                card.scene.greetings.map((text, i) => h('option', { key: i, value: i }, '第 ' + (i + 1) + ' 条 · ' + (text.trim().slice(0, 32) || '待填写'))))),
            h(DialogueExamples, { roleplay: true, values: card.scene.examples, onChange: next => scene('examples', next) })))),
        note('保存后用于新会话，已有会话继续使用开局时的设定。'),
        status.feedback,
        h('div', { className: 'qyb-row qyb-footer' },
          button('返回卡库', () => leave(onCancel)),
          button('保存人设卡', () => status.run(async () => {
            await request('/card/save', { id: record.id, revision: record.revision, card });
            await onSave();
          }), { disabled: status.busy, className: 'qyb-primary' })));
    }
    function CardLibrary({ library, reload }) {
      const [editing, setEditing] = useState(null);
      const [importing, setImporting] = useState(false);
      const [payload, setPayload] = useState('');
      const status = useStatus();
      const label = card => card.roleplay ? '角色扮演已开启' : '角色扮演已关闭';
      const close = () => setEditing(null);
      const makeNew = () => {
        const names = new Set(library.cards.map(card => card.name));
        let name = '新角色';
        for (let i = 2; names.has(name); i++) name = '新角色 ' + i;
        setEditing({ card: blankCard(name) });
      };
      async function previewImport(file) {
        const card = await request('/card/validate', { file });
        setImporting(false);
        setPayload('');
        setEditing({ card });
      }
      if (editing) return h(CardEditor, {
        key: editing.id || 'new', record: editing, onCancel: close,
        onSave: async () => { await reload(); close(); },
      });

      function group(title, cards) {
        return h('section', { className: 'qyb-stack' }, h('h3', null, title),
          cards.length === 0 && note('还没有卡片'),
          cards.length > 0 && h('div', { className: 'qyb-card-list' }, cards.map(card => {
            const isDefault = card.id === library.defaultCardId;
            return h('div', { key: card.id, className: 'qyb-box qyb-card-row', role: 'group', 'aria-label': card.name },
              h('div', { className: 'qyb-row' }, avatar(card),
                h('div', { className: 'qyb-card-title' }, h('strong', null, card.name),
                  h('span', { className: 'qyb-note' }, label(card)),
                  isDefault && h('span', { className: 'qyb-current' }, '默认人设'))),
              h('div', { className: 'qyb-row' },
                button(isDefault ? '取消默认' : '设为默认', () => status.run(async () => {
                  await request('/card/default', { cardId: isDefault ? null : card.id });
                  await reload();
                }), { disabled: status.busy }),
                button('编辑', () => status.run(async () => {
                  setEditing(await request('/card?id=' + query(card.id)));
                }), { disabled: status.busy }),
                button('删除', () => status.run(async () => {
                  const consequence = isDefault ? '新会话将不使用默认人设。' : '';
                  if (!window.confirm('删除人设卡「' + card.name + '」？' + consequence + '已有会话保留原人设。')) return;
                  await request('/card/delete', { id: card.id, revision: card.revision });
                  await reload();
                }), { disabled: status.busy, className: 'qyb-delete' })));
          })));
      }

      return h('div', { className: 'qyb-stack' },
        h('div', { className: 'qyb-row' }, button('新建人设卡', makeNew, { className: 'qyb-primary' }),
          button('导入 JSON', () => setImporting(!importing))),
        importing && h('div', { className: 'qyb-box qyb-stack' },
          h('label', { className: 'qyb-field' }, '选择本插件导出的人设卡 JSON 文件',
            h('input', { type: 'file', accept: '.json,application/json', onChange: event => {
              const [file] = event.target.files;
              if (file) void status.run(async () => previewImport(await readJson(file)));
              event.target.value = '';
            } })),
          field('或粘贴 JSON', payload, setPayload, '粘贴本插件导出的人设卡 JSON', true),
          button('预览导入', () => status.run(() => {
            let file;
            try { file = JSON.parse(payload); } catch { throw new Error('JSON 格式不正确'); }
            return previewImport(file);
          }), { disabled: status.busy || !payload.trim() })),
        status.feedback,
        group('配套卡', library.cards.filter(card => card.builtIn)),
        group('我的卡', library.cards.filter(card => !card.builtIn)));
    }
    function Glossary() {
      const [queryText, setQuery] = useState('');
      const [data, setData] = useState(null);
      const [editing, setEditing] = useState(null);
      const status = useStatus();
      const load = async (q = queryText) => setData(await request('/terms?q=' + query(q)));
      useEffect(() => { void status.run(() => load('')); }, []);
      return h('div', { className: 'qyb-stack' }, h('h3', null, '本地词库'),
        note('自定义词条优先，保存后下一次查词可用。'),
        data && note(data.community.status === 'ready' ? '社区词库 ' + data.community.count + ' 条 · 只读'
          : data.community.status === 'error' ? '社区词库无法读取。自定义词条仍可查询。'
          : '尚未接入社区词库。'),
        h('form', { className: 'qyb-row', onSubmit: event => { event.preventDefault(); void status.run(() => load()); } },
          field('搜索词条', queryText, setQuery, '词名、别名或释义'), h('button', { type: 'submit' }, '搜索'),
          button('新建词条', () => setEditing(blankTerm()))),
        h('label', { className: 'qyb-field' }, '导入词库 JSON · 同名词条会跳过',
          h('input', { type: 'file', accept: '.json,application/json', onChange: event => {
            const [file] = event.target.files;
            if (file) void status.run(async () => {
              const terms = await readJson(file);
              const result = await request('/term/import', { terms });
              await load();
              return '新增 ' + result.saved + ' 条，跳过 ' + result.skipped + ' 条。';
            });
            event.target.value = '';
          } })),
        note('格式示例：[{ "name": "词名", "definition": "释义", "aliases": ["别名"], "usage": "用法", "source": "出处" }]'),
        editing && h('div', { className: 'qyb-box qyb-stack' },
          [['name', '词名（必填）', '例：示例梗'], ['definition', '释义（必填）', '它是什么意思'],
            ['usage', '用法', '这个梗适合在什么场合接'], ['source', '出处', '来源，可留空']].map(([key, label, placeholder]) =>
            h(React.Fragment, { key }, field(label, editing[key], value => setEditing({ ...editing, [key]: value }), placeholder, key === 'definition'))),
          field('别名（以逗号分隔）', editing.aliasText ?? editing.aliases.join('，'),
            aliasText => setEditing({ ...editing, aliasText }), '例：别名一，别名二'),
          h('div', { className: 'qyb-row' }, button('取消', () => setEditing(null)),
            button('保存词条', () => status.run(async () => {
              const aliases = editing.aliasText === undefined ? editing.aliases : editing.aliasText.split(/[,，]/).map(s => s.trim()).filter(Boolean);
              await request('/term/save', { id: editing.id, term: { ...editing, aliases } });
              setEditing(null);
              await load();
              return '词条已保存';
            }), { className: 'qyb-primary', disabled: status.busy }))),
        status.feedback,
        data && note('自定义词库 ' + data.total + ' 条 · 命中 ' + data.matched + ' 条' + (data.matched > 100 ? ' · 显示前 100 条' : '')),
        data?.found && !data.items.some(term => term.name === data.found.name) && h('div', { className: 'qyb-box' },
          h('strong', null, data.found.name), note(data.found.definition), data.found.usage && note('用法：' + data.found.usage)),
        data?.items.map(term => h('div', { key: term.id, className: 'qyb-box' },
          h('strong', null, term.name), note(term.definition), term.usage && note('用法：' + term.usage),
          h('div', { className: 'qyb-row' }, button('编辑', () => setEditing(term)), button('删除', () => status.run(async () => {
            if (!window.confirm('删除后新查询无法找到此词条，旧回复仍保留。继续删除？')) return;
            await request('/term/delete', { id: term.id });
            await load();
          }))))));
    }
    function Panel() {
      const [tab, setTab] = useState('cards');
      const [library, setLibrary] = useState(null);
      const status = useStatus();
      const reload = async () => setLibrary(await request('/library'));
      useEffect(() => { void status.run(reload); }, []);
      return h('div', { className: 'qyb qyb-stack' }, h('h2', null, '角色扮演'),
        h('div', { className: 'qyb-tabs', role: 'tablist', 'aria-label': '角色扮演' },
          tabs.map(([id, label]) => button(label, () => setTab(id), { key: id, role: 'tab', 'aria-selected': tab === id }))),
        status.feedback,
        library && h('div', { role: 'tabpanel' }, tab === 'cards'
          ? h(CardLibrary, { library, reload })
          : h('div', { className: 'qyb-stack' },
            note('修改后用于新会话，无需重启 DSH。'),
            h(SettingsFields, { value: library.defaults, page: tab, change: patch => status.run(async () => {
              const defaults = await request('/defaults', patch);
              setLibrary(current => ({ ...current, defaults }));
              return '已保存新对话默认设置';
            }) }),
            tab === 'tone' && h(TonePreview),
            tab === 'memes' && h(Glossary))));
    }
    return {
      inject: ['slots'],
      apply(ctx) {
        const css = document.createElement('style');
        css.textContent = `
.qyb { color: inherit; }
.qyb h2,.qyb h3,.qyb p { margin: 0; }
.qyb h2 {font-size: 20px;}
.qyb h3 {font-size: 15px;}
.qyb-stack {display:flex;flex-direction:column;gap:12px;}
.qyb-row,.qyb-tabs {display:flex;align-items:center;flex-wrap:wrap;gap:8px;}
.qyb button,.qyb select,.qyb input:not([type=checkbox]):not([type=range]),.qyb textarea {
 padding:6px 9px;border:1px solid color-mix(in srgb,currentColor 24%,transparent);
 border-radius:6px;color:inherit;background:transparent;font:inherit;box-sizing:border-box;
}
.qyb button {cursor:pointer;}
.qyb button:disabled {opacity:.5;cursor:default;}
.qyb button:hover:not(:disabled):not(.qyb-primary):not([aria-selected=true]) {background:color-mix(in srgb,currentColor 10%,transparent);}
.qyb button.qyb-primary,.qyb button[aria-selected=true] {background:#425cc5;color:white;border-color:transparent;}
.qyb-field {display:flex;flex-direction:column;gap:6px;min-width:0;}
.qyb-field :is(input,textarea) {width:100%;}
.qyb select option {background:Canvas;color:CanvasText;}
.qyb textarea {min-height:64px;resize:vertical;}
.qyb button.qyb-switch {display:inline-flex;align-items:center;gap:9px;align-self:flex-start;padding:5px 7px;border-color:transparent;}
.qyb-switch-track {display:inline-flex;align-items:center;width:34px;height:19px;border-radius:999px;background:#737985;padding:2px;box-sizing:border-box;}
.qyb-switch-track::after {content:"";width:15px;height:15px;border-radius:50%;background:#fff;transition:transform .15s ease;}
.qyb-switch[aria-checked=true] .qyb-switch-track {background:#425cc5;}
.qyb-switch[aria-checked=true] .qyb-switch-track::after {transform:translateX(15px);}
@media (prefers-reduced-motion:reduce) {.qyb-switch-track::after {transition:none;}}
.qyb-roleplay summary {cursor:pointer;font-weight:600;}
.qyb-roleplay summary .qyb-note {margin-inline-start:8px;font-weight:400;}
.qyb-roleplay > .qyb-stack {margin-top:10px;}
.qyb-box {padding:10px;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:9px;}
.qyb-box .qyb-row + .qyb-row,.qyb-box .qyb-stack + .qyb-row {margin-top:8px;}
.qyb-current {color:#9cb2ff;font-size:12px;}
.qyb-note {opacity:.76;font-size:12px;line-height:1.55;}
.qyb-error {color:#f18181;font-size:12px;}
.qyb-avatar {display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:9px;object-fit:cover;}
.qyb-initial {background:#4554a2;color:white;}
.qyb-crop {display:flex;flex-wrap:wrap;align-items:center;gap:10px;}
.qyb-crop canvas {width:120px;height:120px;border-radius:8px;}
.qyb-between {justify-content:space-between;}
.qyb-card-list {display:grid;gap:5px;}
.qyb-card-row {display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;padding:8px 10px;}
.qyb-card-title {display:flex;align-items:baseline;gap:7px;flex-wrap:wrap;}
.qyb-card-row .qyb-row + .qyb-row {margin-top:0;}
.qyb button.qyb-delete {color:#ba474b;}
@media (prefers-color-scheme:dark) {.qyb button.qyb-delete {color:#f29091;}}
.qyb-footer {justify-content:flex-end;position:sticky;bottom:0;background:var(--background, Canvas);padding:8px 0;}
`;
        document.head.appendChild(css);
        ctx.effect(() => () => css.remove(), '角色扮演样式');
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'quyubagu-settings', label: '角色扮演', priority: 100,
        }, Panel));
      },
    };
  },
});
