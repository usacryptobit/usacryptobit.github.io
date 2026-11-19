import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ImagePlus, Inbox, MessageSquare, RefreshCw, Send, X } from 'lucide-react'
import { supabase } from './supabase'

const dateTime = value => value ? new Date(value).toLocaleString() : ''

export default function SupportMessagesPanel({ currentUser, isAdmin = false, customers = [], notify, initialConversationId, onUnreadChange }) {
  const [conversations,setConversations]=useState([]),[selected,setSelected]=useState(null),[messages,setMessages]=useState([])
  const [loading,setLoading]=useState(true),[messagesLoading,setMessagesLoading]=useState(false),[sending,setSending]=useState(false)
  const [subject,setSubject]=useState(''),[firstMessage,setFirstMessage]=useState(''),[reply,setReply]=useState(''),[recipientId,setRecipientId]=useState(''),[error,setError]=useState(''),[attachment,setAttachment]=useState(null),[attachmentUrls,setAttachmentUrls]=useState({})
  const attachmentInput=useRef(null),signedUrlCache=useRef({})
  const readMarkers=useRef({})

  const loadConversations=useCallback(async quiet=>{
    if(!quiet)setLoading(true)
    const {data,error:loadError}=await supabase.from('support_conversations').select('id,customer_id,subject,status,customer_last_read_at,created_at,updated_at').order('updated_at',{ascending:false}).limit(100)
    if(loadError){setError('Could not load messages. Run the latest Supabase schema, then refresh.');setConversations([])}
    else{if(!isAdmin)for(const conversation of data??[])if(readMarkers.current[conversation.id]===undefined)readMarkers.current[conversation.id]=conversation.customer_last_read_at;setConversations(data??[]);setError('')}
    setLoading(false)
  },[isAdmin])

  const markReadIfNeeded=useCallback(async(conversationId,rows)=>{
    if(isAdmin)return
    const incoming=(rows??[]).filter(message=>message.sender_id!==currentUser.id)
    const marker=readMarkers.current[conversationId]
    if(!incoming.some(message=>!marker||new Date(message.created_at)>new Date(marker)))return
    const {data,error:readError}=await supabase.rpc('mark_customer_support_read',{p_conversation_id:conversationId})
    if(readError)return
    const readAt=data||new Date().toISOString()
    readMarkers.current[conversationId]=readAt
    setConversations(previous=>previous.map(conversation=>conversation.id===conversationId?{...conversation,customer_last_read_at:readAt}:conversation))
    onUnreadChange?.()
  },[isAdmin,currentUser.id,onUnreadChange])

  const loadMessages=useCallback(async(conversationId,quiet)=>{
    if(!quiet)setMessagesLoading(true)
    const {data,error:loadError}=await supabase.from('support_messages').select('id,conversation_id,sender_id,body,attachment_path,attachment_name,created_at').eq('conversation_id',conversationId).order('created_at',{ascending:true}).limit(250)
    if(loadError)setError('Could not load this conversation.')
    else{setMessages(data??[]);const now=Date.now(),unresolved=(data??[]).filter(message=>message.attachment_path&&(!signedUrlCache.current[message.attachment_path]||signedUrlCache.current[message.attachment_path].expiresAt<now+60000));if(unresolved.length){const signed=await Promise.all(unresolved.map(async message=>{const {data:signedData}=await supabase.storage.from('support-attachments').createSignedUrl(message.attachment_path,3600);return signedData?.signedUrl?[message.attachment_path,{url:signedData.signedUrl,expiresAt:now+3500000}]:null}));for(const entry of signed)if(entry)signedUrlCache.current[entry[0]]=entry[1];setAttachmentUrls(previous=>({...previous,...Object.fromEntries(signed.filter(Boolean).map(([path,value])=>[path,value.url]))}))}await markReadIfNeeded(conversationId,data??[])}
    setMessagesLoading(false)
  },[markReadIfNeeded])

  useEffect(()=>{
    loadConversations(false)
    const timer=setInterval(()=>loadConversations(true),8000)
    return()=>clearInterval(timer)
  },[loadConversations])

  useEffect(()=>{if(initialConversationId)setSelected(initialConversationId)},[initialConversationId])

  useEffect(()=>{
    if(!selected){setMessages([]);return}
    loadMessages(selected,false)
    const timer=setInterval(()=>loadMessages(selected,true),5000)
    return()=>clearInterval(timer)
  },[selected,loadMessages])

  const sendFirstMessage=async event=>{
    event.preventDefault()
    const cleanSubject=subject.trim(),cleanBody=firstMessage.trim()
    if(!cleanSubject||(!cleanBody&&!attachment)||sending)return
    if(cleanSubject.length>120||cleanBody.length>5000){setError('Keep the subject under 120 characters and message under 5,000 characters.');return}
    setSending(true);setError('')
    const {data:conversation,error:conversationError}=await supabase.from('support_conversations').insert({customer_id:currentUser.id,subject:cleanSubject}).select('id,customer_id,subject,status,customer_last_read_at,created_at,updated_at').single()
    if(conversationError){setError(conversationError.message);setSending(false);return}
    const attachmentMetadata=await uploadAttachment(conversation.id)
    if(attachmentMetadata===false){setSending(false);return}
    const {error:messageError}=await supabase.from('support_messages').insert({conversation_id:conversation.id,sender_id:currentUser.id,body:cleanBody||'Image attachment',...(attachmentMetadata||{})})
    if(messageError){setError(`The conversation was created, but the first message could not be sent: ${messageError.message}`);setSending(false);await loadConversations(true);return}
    setSubject('');setFirstMessage('');clearAttachment();setConversations(previous=>[conversation,...previous]);setSelected(conversation.id)
    notify?.('Message sent to the support team')
    await loadConversations(true);setSending(false)
  }

  const sendAdminFirstMessage=async event=>{
    event.preventDefault()
    const cleanSubject=subject.trim(),cleanBody=firstMessage.trim()
    if(!recipientId||!cleanSubject||(!cleanBody&&!attachment)||sending)return
    if(cleanSubject.length>120||cleanBody.length>5000){setError('Keep the subject under 120 characters and message under 5,000 characters.');return}
    setSending(true);setError('')
    const {data:conversation,error:conversationError}=await supabase.from('support_conversations').insert({customer_id:recipientId,subject:cleanSubject}).select('id,customer_id,subject,status,customer_last_read_at,created_at,updated_at').single()
    if(conversationError){setError(conversationError.message);setSending(false);return}
    const attachmentMetadata=await uploadAttachment(conversation.id)
    if(attachmentMetadata===false){setSending(false);return}
    const {error:messageError}=await supabase.from('support_messages').insert({conversation_id:conversation.id,sender_id:currentUser.id,body:cleanBody||'Image attachment',...(attachmentMetadata||{})})
    if(messageError){setError(`The conversation was created, but the first message could not be sent: ${messageError.message}`);setSending(false);await loadConversations(true);return}
    setSubject('');setFirstMessage('');clearAttachment();setConversations(previous=>[conversation,...previous]);setSelected(conversation.id)
    notify?.('Message sent to the customer')
    await loadConversations(true);setSending(false)
  }

  const sendReply=async event=>{
    event.preventDefault()
    const cleanBody=reply.trim()
    if(!selected||(!cleanBody&&!attachment)||sending)return
    if(cleanBody.length>5000){setError('Keep your message under 5,000 characters.');return}
    setSending(true);setError('')
    const attachmentMetadata=await uploadAttachment(selected)
    if(attachmentMetadata===false){setSending(false);return}
    const {error:sendError}=await supabase.from('support_messages').insert({conversation_id:selected,sender_id:currentUser.id,body:cleanBody||'Image attachment',...(attachmentMetadata||{})})
    if(sendError)setError(sendError.message)
    else{setReply('');clearAttachment();notify?.('Reply sent');await loadMessages(selected,true);await loadConversations(true)}
    setSending(false)
  }

  const uploadAttachment=async conversationId=>{
    if(!attachment)return null
    const extension=attachment.name.split('.').pop()?.toLowerCase()||'jpg'
    const path=`${conversationId}/${currentUser.id}/${crypto.randomUUID()}.${extension}`
    const {error:uploadError}=await supabase.storage.from('support-attachments').upload(path,attachment,{contentType:attachment.type,upsert:false})
    if(uploadError){setError(`Could not upload the picture: ${uploadError.message}`);return false}
    return {attachment_path:path,attachment_name:attachment.name}
  }
  const clearAttachment=()=>{setAttachment(null);if(attachmentInput.current)attachmentInput.current.value=''}
  const selectAttachment=event=>{const file=event.target.files?.[0];if(!file)return;if(!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)){setError('Choose a JPG, PNG, WEBP, or GIF picture.');event.target.value='';return}if(file.size>5*1024*1024){setError('Picture must be 5 MB or smaller.');event.target.value='';return}setError('');setAttachment(file)}
  const attachmentPicker=<div className="support-attachment-picker"><input ref={attachmentInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={selectAttachment} aria-label="Choose an optional picture"/><button type="button" className="support-attach-button" onClick={()=>attachmentInput.current?.click()}><ImagePlus size={15}/> Attach picture <span>Optional</span></button>{attachment&&<div className="support-attachment-selected"><span>{attachment.name}</span><button type="button" onClick={clearAttachment} aria-label="Remove picture"><X size={14}/></button></div>}</div>

  const selectedConversation=conversations.find(item=>item.id===selected)
  const customerEmail=id=>customers.find(customer=>customer.id===id)?.email||'Customer'

  return <section className={`support-messages ${isAdmin?'support-messages-admin':''}`}>
    <div className="admin-heading"><div><div className="eyebrow"><span className="eyebrow-line"/>{isAdmin?'CUSTOMER SUPPORT':'YOUR ACCOUNT'}</div><h1>{isAdmin?'Customer inbox':'Messages'}</h1><p>{isAdmin?'Read and reply to private customer conversations.':'Send a private message to the USA CryptoBit support team.'}</p></div><button className="admin-refresh" onClick={()=>loadConversations(false)} disabled={loading}><RefreshCw size={15}/> Refresh</button></div>
    {!isAdmin&&<div className="support-privacy"><MessageSquare size={16}/><span>Your messages are visible to you and the support administrators for this account.</span></div>}
    {error&&<div className="admin-error">{error}</div>}
    {!selected&&<form className="support-compose" onSubmit={isAdmin?sendAdminFirstMessage:sendFirstMessage}>{isAdmin&&<label>Customer<select value={recipientId} onChange={event=>setRecipientId(event.target.value)} required><option value="">Choose a customer…</option>{customers.filter(customer=>customer.role!=='admin').map(customer=><option key={customer.id} value={customer.id}>{customer.email}</option>)}</select></label>}<label>Subject<input value={subject} onChange={event=>setSubject(event.target.value)} required maxLength={120} placeholder={isAdmin?'Message subject':'What can we help with?'}/></label><label>Message<textarea value={firstMessage} onChange={event=>setFirstMessage(event.target.value)} maxLength={5000} rows={4} placeholder={isAdmin?'Write a message to the customer…':'Write a message to the support team…'}/></label>{attachmentPicker}<button className="submit-btn" disabled={sending||(!firstMessage.trim()&&!attachment)}>{isAdmin?<MessageSquare size={15}/>:<Send size={15} />}{sending?'Sending…':isAdmin?'Send to customer':'Send message'}</button></form>}
    <div className="support-layout">
      <div className={`support-thread-list ${selected?'support-thread-list-hidden':''}`}>
        {loading?<div className="support-empty"><span className="spinner"/>Loading inbox…</div>:conversations.length?conversations.map(conversation=><button key={conversation.id} type="button" className={`support-thread-link ${selected===conversation.id?'support-thread-selected':''}`} onClick={()=>{setError('');if(!isAdmin)readMarkers.current[conversation.id]=conversation.customer_last_read_at;setSelected(conversation.id)}}><span className="support-thread-avatar"><MessageSquare size={14}/></span><span className="support-thread-copy"><b>{isAdmin?customerEmail(conversation.customer_id):conversation.subject}</b><span>{isAdmin?conversation.subject:conversation.status==='open'?'Support conversation':'Conversation'}</span><small>{dateTime(conversation.updated_at)}</small></span><i className={`support-status support-status-${conversation.status}`}>{conversation.status}</i></button>):<div className="support-empty"><Inbox size={22}/><b>No messages yet</b><span>{isAdmin?'Customer messages will appear here.':'Send a message to start a conversation.'}</span></div>}
      </div>
      <div className={`support-thread ${selected?'support-thread-open':''}`}>
        {selectedConversation?<><div className="support-thread-heading"><button type="button" className="support-back" onClick={()=>setSelected(null)} aria-label="Back to inbox"><ArrowLeft size={16}/></button><div><b>{isAdmin?customerEmail(selectedConversation.customer_id):selectedConversation.subject}</b><span>{isAdmin?selectedConversation.subject:`Support · ${selectedConversation.status}`}</span></div><span className={`support-status support-status-${selectedConversation.status}`}>{selectedConversation.status}</span></div>
          <div className="support-message-list">{messagesLoading&&!messages.length?<div className="support-empty"><span className="spinner"/>Loading conversation…</div>:messages.length?messages.map(message=><article key={message.id} className={`support-message ${message.sender_id===currentUser.id?'support-message-mine':''}`}><span className="support-message-author">{message.sender_id===currentUser.id?'You':isAdmin?'Customer':'Support team'}</span>{message.body!=='Image attachment'&&<p>{message.body}</p>}{message.attachment_path&&attachmentUrls[message.attachment_path]&&<a className="support-image-attachment" href={attachmentUrls[message.attachment_path]} target="_blank" rel="noreferrer"><img src={attachmentUrls[message.attachment_path]} alt={message.attachment_name||'Message attachment'}/><span>{message.attachment_name||'Open attached picture'}</span></a>}<time>{dateTime(message.created_at)}</time></article>):<div className="support-empty">No messages in this conversation yet.</div>}</div>
          <form className="support-reply" onSubmit={sendReply}><textarea value={reply} onChange={event=>setReply(event.target.value)} maxLength={5000} rows={3} placeholder="Write a reply…"/>{attachmentPicker}<button className="submit-btn" disabled={sending||(!reply.trim()&&!attachment)}><Send size={15}/>{sending?'Sending…':'Send reply'}</button></form>
        </>:<div className="support-empty support-thread-placeholder"><MessageSquare size={23}/><b>Select a conversation</b><span>{isAdmin?'Choose a customer thread to read and reply.':'Your support messages will appear here.'}</span></div>}
      </div>
    </div>
  </section>
}
