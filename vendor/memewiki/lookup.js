export function lookupMeme(conn, query) {
  const q = String(query || '').trim()
  if (!q) return null
  if (!conn) return null
  try {
    // 1) 完全一样
    const exact = conn.prepare('SELECT * FROM memes WHERE title = ?').get(q)
    if (exact) return exact
    // 1.5) 别名（缩写/俗称：「kskbl」→「康神开播了」）。别名逗号分隔，整项精确比对。
    const 别名 = conn.prepare(
      "SELECT * FROM memes WHERE aliases IS NOT NULL AND instr(',' || lower(aliases) || ',', ',' || lower(?) || ',') > 0 LIMIT 1",
    ).get(q)
    if (别名) return 别名
    // 2) 标题以查询词开头（「48」→「48上单」、「tes」→「TES48」）。
    //    前缀比"包含"更精确，不会像两字中文那样乱中；取最短的那条，最接近。
    const 前缀 = conn.prepare(
      "SELECT * FROM memes WHERE instr(lower(title), lower(?)) = 1 ORDER BY length(title) ASC LIMIT 1",
    ).get(q)
    if (前缀) return 前缀
    // 3) 查询词里包含标题（问「去码头整点薯条是什么梗」）——取最长标题，最具体
    const 反查 = conn.prepare(
      'SELECT * FROM memes WHERE length(title) >= 2 AND instr(?, title) > 0 ORDER BY length(title) DESC LIMIT 1',
    ).get(q)
    if (反查) return 反查
    // 4) 标题里包含查询词（短着问「码头整」）。
    //    中文至少 3 个字才做，否则「码头」「典」这种随手两字会乱中；
    //    纯数字/字母（「48」「233」）两字也放宽——它们够specific，不放开就查不到「48上单」。
    const 短词放宽 = q.length >= 2 && /^[0-9a-z]+$/i.test(q)
    if (q.length >= 3 || 短词放宽) {
      const 正查 = conn.prepare(
        'SELECT * FROM memes WHERE instr(title, ?) > 0 ORDER BY length(title) ASC LIMIT 1',
      ).get(q)
      if (正查) return 正查
    }
    return null
  } catch (e) {
    console.warn('[memewiki] 查词库失败：' + (e && e.message))
    return null
  }
}

const 问梗模式 = /(?:是)?(?:什么梗|啥梗|什么来头|什么来历|什么出处|什么意思|啥意思|怎么用|怎么接|怎么玩|如何用)(?:啊|呀|呢|的|啊这是)?[？?。！!~～]*$/
const 裸词模式 = /^[\u4e00-\u9fa5A-Za-z0-9·]{2,10}$/

const 无语义词 = new Set([
  '这', '那', '它', '他', '她', '这个', '那个', '你', '这句话', '那句话', '上面', '刚才', '下文', '前面',
])

const 停用词 = new Set([
  '在吗', '在不在', '哈哈', '哈哈哈', '笑死', '好的', '好吧', '晚安', '早安',
  '睡觉', '吃饭', '干嘛', '没事', '收到', '谢谢', '好耶', '草', '典', '乐',
])

// 明显是闲聊/问状态的整句，别当梗去查
const 闲聊短语 = new Set([
  '我是谁', '错了', '情绪', '接下一句', '你也学一个', '今天看什么', '到底多少了',
  '搜出来了吗', '来点贴吧评价', '都是同龄人', '你同事', '道德这么高',
  '这是谁的手臂', '比我能串', '宝宝你醒了', '中国人能不能飞', '你现在什么人格',
])

const 句子成分 = /怎么样|怎么|多少|为什么|能不能|是不是|什么|了吗|了没|一下|你说|要不要|有没有/

const 唤醒词 = ['小鲸鱼', '大鲸鱼', '大肥鲸', '小肥鲸', '大肥鱼', '奶鱼', '鲸鱼', 'deepseek', 'ds']

function 清文本(text) {
  let t = String(text || '').trim()
  t = t.replace(/^(@\S+\s*)+/, '')
  for (const w of 唤醒词) {
    if (t.startsWith(w)) {
      t = t.slice(w.length).trim().replace(/^[，,。.！!？?:：]+|[，,。.！!？?:：]+$/g, '')
      break
    }
  }
  return t.trim()
}

/** 从一句话里提取候选词条；不是问梗就返回 null */
export function extractMemeQuery(text) {
  const t = 清文本(text)
  if (!t) return null
  const m = 问梗模式.exec(t)
  if (m) {
    let head = t.slice(0, m.index).replace(/^[ ，,。.！!？?]+|[ ，,。.！!？?]+$/g, '')
    head = head.replace(/^[是]+|[是]+$/g, '').trim()
    head = head.replace(/(这个梗|那个梗|这梗|那梗|这个|那个)$/, '').trim()
    head = head.replace(/(到底|究竟)$/, '').trim()
    if (无语义词.has(head)) return null
    if (head.length <= 2 && '这那它他她'.includes(head[0])) return null
    if (head.length > 1 && head.length <= 12) return head
    return null
  }
  if (裸词模式.test(t) && !停用词.has(t) && !闲聊短语.has(t)) {
    if (句子成分.test(t)) return null
    return t
  }
  return null
}
