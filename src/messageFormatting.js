const allowedTags=new Set(['p','div','span','strong','b','em','i','u','s','strike','br','ul','ol','li','blockquote','h1','h2','h3','h4','h5','h6','sub','sup'])
const blockedTags=new Set(['script','style','iframe','object','embed','svg','math','template','noscript'])
const namedColors=new Set(['black','white','red','green','blue','yellow','orange','purple','pink','gray','grey','brown','navy','teal','maroon','olive','lime','aqua','fuchsia','silver','transparent','rebeccapurple','windowtext'])

const escapeHtml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;')

function safeColor(value){
  const color=String(value||'').trim().toLowerCase()
  if(/^#[\da-f]{3,8}$/i.test(color)||namedColors.has(color)||(/^[a-z]{1,25}$/.test(color)&&window.CSS?.supports('color',color))||/^rgba?\([\d\s.,%+-]+\)$/.test(color)||/^hsla?\([\d\s.,%+-]+\)$/.test(color))return color
  return ''
}

function safeFontFamily(value){
  const family=String(value||'').replace(/[<>;{}]/g,'').replace(/url\s*\([^)]*\)/gi,'').trim()
  if(!family||family.length>100||!/^[\w\s,'"-]+$/.test(family))return ''
  return family
}

function safeFontSize(value){
  const match=String(value||'').trim().match(/^(\d+(?:\.\d+)?)(px|pt|em|rem|%)$/i)
  if(!match)return ''
  let amount=Number(match[1]),unit=match[2].toLowerCase()
  if(unit==='pt'){amount*=4/3;unit='px'}
  if(amount<6||amount>72)return ''
  return `${amount}${unit}`
}

function safeStyles(element){
  const styles=new Map()
  const set=(name,value)=>{if(value)styles.set(name,value)}
  const styleNode=element.ownerDocument.createElement('span')
  styleNode.setAttribute('style',element.getAttribute('style')||'')
  const style=styleNode.style
  set('font-family',safeFontFamily(style.getPropertyValue('font-family')))
  set('font-size',safeFontSize(style.getPropertyValue('font-size')))
  set('color',safeColor(style.getPropertyValue('color')))
  set('background-color',safeColor(style.getPropertyValue('background-color')))
  const alignment=style.getPropertyValue('text-align').toLowerCase()
  if(['left','right','center','justify'].includes(alignment))set('text-align',alignment)
  const lineHeight=style.getPropertyValue('line-height').trim()
  if(lineHeight.toLowerCase()==='normal')set('line-height','normal')
  else if(/^\d+(?:\.\d+)?$/i.test(lineHeight)&&Number(lineHeight)<=2.5)set('line-height',lineHeight)
  else {
    const lineHeightMatch=lineHeight.match(/^(\d+(?:\.\d+)?)(px|pt|em|rem|%)$/i)
    if(lineHeightMatch){
      const amount=Number(lineHeightMatch[1]),unit=lineHeightMatch[2].toLowerCase()
      const max=unit==='px'?48:unit==='pt'?36:unit==='%'?250:2.5
      if(amount<=max)set('line-height',lineHeight)
    }
  }
  const weight=style.getPropertyValue('font-weight').toLowerCase()
  if(weight==='bold'||Number(weight)>=600)set('font-weight','bold')
  const fontStyle=style.getPropertyValue('font-style').toLowerCase()
  if(fontStyle==='italic'||fontStyle==='oblique')set('font-style','italic')
  const decoration=style.getPropertyValue('text-decoration-line')||style.getPropertyValue('text-decoration')
  const safeDecoration=['underline','line-through'].filter(item=>decoration.includes(item))
  if(safeDecoration.length)set('text-decoration',safeDecoration.join(' '))
  if(element.tagName==='FONT'){
    set('font-family',safeFontFamily(element.getAttribute('face'))||styles.get('font-family'))
    set('color',safeColor(element.getAttribute('color'))||styles.get('color'))
    const legacySize=Number(element.getAttribute('size'))
    if(legacySize>=1&&legacySize<=7)set('font-size',`${[10,13,16,18,24,32,48][legacySize-1]}px`)
  }
  return [...styles].map(([name,value])=>`${name}:${value}`).join(';')
}

function cleanNode(node){
  if(node.nodeType===Node.TEXT_NODE)return escapeHtml(node.nodeValue||'')
  if(node.nodeType!==Node.ELEMENT_NODE)return ''
  const tag=node.tagName.toLowerCase()
  if(blockedTags.has(tag))return ''
  if(['p','div'].includes(tag)&&!(node.textContent||'').replace(/[\s\u00a0]/g,'')&&!node.querySelector('img,video,audio'))return ''
  const children=[...node.childNodes].map(cleanNode).join('')
  if(tag==='font')return `<span${safeStyles(node)?` style="${escapeHtml(safeStyles(node))}"`:''}>${children}</span>`
  if(!allowedTags.has(tag))return children
  const style=safeStyles(node)
  return `<${tag}${style?` style="${escapeHtml(style)}"`:''}>${children}</${tag}>`
}

export function sanitizeRichHtml(html){
  if(typeof window==='undefined'||typeof DOMParser==='undefined')return escapeHtml(html||'')
  const parsed=new DOMParser().parseFromString(String(html||''),'text/html')
  for(const styleElement of parsed.querySelectorAll('style')){
    let rules=[]
    try{rules=[...styleElement.sheet.cssRules]}catch{}
    for(const rule of rules){
      if(!rule.selectorText||!rule.style)continue
      for(const token of rule.selectorText.match(/\.[A-Za-z_][\w-]*/g)||[]){
        for(const element of parsed.body.querySelectorAll(token))element.setAttribute('style',`${element.getAttribute('style')||''};${rule.style.cssText}`)
      }
    }
  }
  return [...parsed.body.childNodes].map(cleanNode).join('')
}

export function richHtmlToText(html){
  if(typeof window==='undefined'||typeof DOMParser==='undefined')return String(html||'').replace(/<[^>]*>/g,' ')
  const parsed=new DOMParser().parseFromString(sanitizeRichHtml(html),'text/html')
  return (parsed.body.innerText||parsed.body.textContent||'').replace(/\u00a0/g,' ').trim()
}
