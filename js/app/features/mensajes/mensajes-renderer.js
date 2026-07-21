// mensajes-renderer.js — HTML generators for the App Shell mensajes view
import { docIconForExt, isImageFile, isAudioFile, linkifyText } from './mensajes-attachments.js';
import { formatMsgTime, formatMsgTimeShort, messageSnippet, msgTs } from './mensajes-data.js';

export function esc(v) {
  return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function initials(value) {
  const parts = String(value || 'U').replace(/@.*/, '').split(/\s+|[._-]+/).filter(Boolean);
  return (parts[0]?.[0] || 'U').toUpperCase() + (parts[1]?.[0] || '').toUpperCase();
}

export function shellLayout(meDisplay) {
  return `
<div class="am">
  <div class="am-layout">
    <aside class="am-sidebar" id="amSidebar">
      <div class="am-sb-head">
        <div class="am-sb-user">
          <span id="amPanelUser">${esc(meDisplay || 'Mensajes')}</span>
          <span class="material-icons" style="font-size:16px;color:#94a3b8;">expand_more</span>
        </div>
        <div class="am-sb-actions">
          <button id="amNewChat" class="am-icon-btn" title="Nuevo mensaje"><span class="material-icons">edit_square</span></button>
          <button id="amRefresh" class="am-icon-btn" title="Refrescar"><span class="material-icons">refresh</span></button>
        </div>
      </div>
      <div class="am-search">
        <span class="material-icons am-search-icon">search</span>
        <input type="text" id="amSearch" class="am-search-input" placeholder="Buscar contacto, plaza o rol">
      </div>
      <div class="am-tabs">
        <span class="am-tab-label">Buzón operativo</span>
        <button id="amArchiveToggle" class="am-tab-btn" type="button">Archivados</button>
      </div>
      <div class="am-filters">
        <label class="am-filter"><span class="material-icons">apartment</span>
          <select id="amFilterPlaza"><option value="">Todas plazas</option></select></label>
        <label class="am-filter"><span class="material-icons">badge</span>
          <select id="amFilterRol"><option value="">Todos roles</option></select></label>
        <label class="am-filter"><span class="material-icons">tune</span>
          <select id="amFilterStatus"><option value="">Todos</option>
            <option value="UNREAD">No leídos</option>
            <option value="ACTIVE">Activos</option>
            <option value="INACTIVE">Inactivos</option></select></label>
        <button id="amFilterClear" class="am-filter-reset"><span class="material-icons" style="font-size:14px;">refresh</span> Limpiar</button>
      </div>
      <div id="amContactsHint" class="am-hint">Cargando conversaciones...</div>
      <div id="amContactsList" class="am-contacts-list"></div>
    </aside>
    <section class="am-chat" id="amChat">
      <div id="amEmptyState" class="am-empty">
        <div class="am-empty-icon"><span class="material-icons">send</span></div>
        <h3>Selecciona una conversación</h3>
        <p>Consulta acuerdos, archivos y seguimiento interno desde un canal limpio de operación.</p>
        <button class="am-empty-btn" id="amEmptyBtn">Nuevo mensaje</button>
      </div>
      <div id="amChatHeader" class="am-chat-header" style="display:none;">
        <button id="amBackBtn" class="am-back"><span class="material-icons">arrow_back</span></button>
        <button id="amChatAvatar" class="am-chat-av">U</button>
        <div class="am-chat-hinfo">
          <div id="amChatName" class="am-chat-name">Nombre</div>
          <div id="amChatStatus" class="am-chat-status">Canal interno</div>
        </div>
        <div class="am-chat-hactions">
          <button id="amArchiveBtn" class="am-hbtn" title="Archivar" style="display:none;"><span class="material-icons">delete_outline</span></button>
          <button id="amInfoBtn" class="am-hbtn" title="Info"><span class="material-icons">info</span></button>
        </div>
      </div>
      <div id="amMessages" class="am-messages" style="display:none;"></div>
      <div id="amStaging" class="am-staging"></div>
      <div id="amInputBar" class="am-input-bar" style="display:none;">
        <input type="file" id="amFileInput" style="display:none;" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt">
        <button id="amAttachBtn" class="am-attach"><span class="material-icons">add_circle</span></button>
        <div class="am-input-box">
          <textarea id="amInput" rows="1" class="am-textarea" placeholder="Escribe una actualización..."></textarea>
        </div>
        <button id="amMicBtn" class="am-mic"><span class="material-icons">mic</span></button>
        <button id="amSendBtn" class="am-send"><span class="material-icons">send</span></button>
      </div>
    </section>
  </div>
</div>
<div id="amLightbox" class="am-lightbox" style="display:none;">
  <button id="amLightboxClose" class="am-lb-close"><span class="material-icons">close</span></button>
  <img id="amLightboxImg" src="" alt="">
  <a id="amLightboxDl" href="" download class="am-lb-dl"><span class="material-icons" style="font-size:16px;">download</span> Descargar</a>
</div>
<div id="amUserInfoModal" class="am-info-overlay">
  <div class="am-info-card">
    <button id="amInfoClose" class="am-info-close"><span class="material-icons">close</span></button>
    <div id="amInfoContent"></div>
  </div>
</div>`;
}

export function renderContactItem(c, meta, isActive, isArchived) {
  const unread = c.unread || 0;
  const snippet = c.last ? messageSnippet(c.last) : 'Abrir conversación';
  const display = c.last?.esMio ? `Tú: ${snippet}` : snippet;
  const truncated = display.length > 55 ? display.substring(0, 55) + '…' : display;
  const time = c.last ? formatMsgTime(c.last) : '';
  const m = meta || {};
  const contactName = String(m.nombre || c.displayLabel || c.peerEmail || 'USUARIO').trim().toUpperCase();
  const badge = [m.plaza, m.rol].filter(Boolean).join(' · ');
  return `
<div class="am-contact${isActive ? ' active' : ''}${unread ? ' has-unread' : ''}${isArchived ? ' archived' : ''}" data-peer="${esc(c.peerKey)}">
  <div class="am-contact-av">${esc(initials(contactName))}</div>
  <div class="am-contact-body">
    <div class="am-contact-top">
      <span class="am-contact-name">${esc(contactName)}${isArchived ? ' <span class="am-archived-tag">Archivado</span>' : ''}</span>
      <span class="am-contact-time${unread ? ' unread' : ''}">${esc(time)}</span>
    </div>
    <div class="am-contact-sub">${esc(badge || 'Contacto')}</div>
    <div class="am-contact-snippet${unread ? ' unread' : ''}">${esc(truncated)}</div>
    ${unread ? `<span class="am-unread-badge">${unread}</span>` : ''}
  </div>
</div>`;
}

export function renderMessage(m, userName) {
  const mine = !!m.esMio;
  const cls = mine ? 'sent' : 'received';
  const mId = String(m.id).replace(/[^a-zA-Z0-9_-]/g, '_');
  let check = '';
  if (mine) {
    check = m.leido
      ? '<span class="material-icons" style="font-size:12px;color:#93c5fd;">done_all</span>'
      : '<span class="material-icons" style="font-size:12px;opacity:0.5;">done</span>';
  }
  // Reply quote
  let replyHtml = '';
  if (m.replyTo) {
    replyHtml = `<div class="am-reply-quote"><div class="am-rq-author">${esc(m.replyTo.remitente || '')}</div><div class="am-rq-text">${esc(String(m.replyTo.mensaje || '').substring(0, 80))}</div></div>`;
  }
  // Text
  let msgText = m.mensaje || '';
  if (m.archivoUrl && msgText === `📎 ${m.archivoNombre}`) msgText = '';
  let contenido = msgText ? linkifyText(esc(msgText)) : '';
  // File
  let fileHtml = '';
  if (m.archivoUrl) {
    const nom = m.archivoNombre || '';
    if (isImageFile(nom)) {
      fileHtml = `<div class="am-file-wrap"><img class="am-img-thumb" src="${m.archivoUrl}" alt="${esc(nom)}" data-lightbox="${m.archivoUrl}"></div>`;
    } else if (isAudioFile(nom)) {
      fileHtml = `<div class="am-audio-card"><span class="material-icons">graphic_eq</span><audio controls src="${m.archivoUrl}"></audio></div>`;
    } else {
      const ext = nom.split('.').pop().toUpperCase();
      fileHtml = `<div class="am-doc-card"><span class="material-icons">${docIconForExt(ext)}</span><div class="am-doc-info"><div class="am-doc-name">${esc(nom || 'Archivo')}</div><div class="am-doc-ext">${ext}</div></div><a class="am-doc-dl" href="${m.archivoUrl}" target="_blank" rel="noopener" download><span class="material-icons" style="font-size:16px;">download</span></a></div>`;
    }
  }
  // Reactions
  const reacs = m.reacciones || {};
  const reacEntries = Object.entries(reacs).filter(([, u]) => u && u.length > 0);
  let reactionsHtml = `<div class="am-reactions">`;
  if (reacEntries.length) {
    reactionsHtml += reacEntries.map(([emoji, users]) => {
      const isMine = users.includes(userName) ? ' mine' : '';
      return `<button class="am-react-btn${isMine}" data-mid="${mId}" data-emoji="${esc(emoji)}" title="${esc(users.join(', '))}">${emoji}<span>${users.length}</span></button>`;
    }).join('');
  }
  reactionsHtml += `<button class="am-add-react" data-mid="${mId}" title="Agregar reacción"><span class="material-icons">add_reaction</span></button></div>`;
  // Edit/Delete
  let optionsHtml = '';
  if (mine) {
    optionsHtml = `<div class="am-msg-opts"><button class="am-opt-btn" data-action="edit" data-mid="${mId}" title="Editar"><span class="material-icons">edit</span></button><button class="am-opt-btn del" data-action="delete" data-mid="${mId}" title="Borrar"><span class="material-icons">delete</span></button></div>`;
  }
  // Reply
  const replyBtn = `<button class="am-reply-btn" data-mid="${mId}" title="Responder"><span class="material-icons">reply</span></button>`;
  const timeStr = formatMsgTimeShort(m);
  return `<div class="am-bubble ${cls}" id="bubble-${mId}">${replyHtml}${contenido ? `<div class="am-bubble-text">${contenido}</div>` : ''}${fileHtml}${optionsHtml}${replyBtn}<span class="am-bubble-time">${esc(timeStr)} ${check}</span>${reactionsHtml}</div>`;
}

export function renderContactInfo(user) {
  const name = String(user?.nombre || user?.usuario || 'USUARIO').trim().toUpperCase();
  const plaza = String(user?.plazaAsignada || user?.plaza || 'Sin plaza').toUpperCase();
  const role = user?.rol || 'Sin rol';
  const email = String(user?.email || '').trim().toLowerCase() || 'Sin correo';
  const phone = user?.telefono || 'Sin teléfono';
  const status = String(user?.status || 'ACTIVO').toUpperCase();
  return `
<div class="am-info-hero">
  <div class="am-info-av">${esc(initials(name))}</div>
  <div><div class="am-info-name">${esc(name)}</div><div class="am-info-sub">${esc(role)} · ${esc(plaza)}</div></div>
</div>
<div class="am-info-body">
  <div class="am-info-row"><span>Correo</span><span>${esc(email)}</span></div>
  <div class="am-info-row"><span>Plaza</span><span>${esc(plaza)}</span></div>
  <div class="am-info-row"><span>Rol</span><span>${esc(role)}</span></div>
  <div class="am-info-row"><span>Status</span><span>${esc(status)}</span></div>
  <div class="am-info-row"><span>Teléfono</span><span>${esc(phone)}</span></div>
</div>
<div class="am-info-actions">
  <button class="am-info-action primary" data-chat-name="${esc(name)}">Abrir chat</button>
  <button class="am-info-action secondary" id="amInfoCloseBtn">Cerrar</button>
</div>`;
}

export function renderDirectoryContact(user, isActive, identity = null) {
  const email  = String(identity?.email || user.email || user.id || '').toLowerCase();
  const nombre = String(identity?.label || user.nombre || user.nombreCompleto || user.usuario || '').trim() || email;
  const plaza  = String(user.plazaAsignada || user.plaza || '').toUpperCase();
  const rol    = String(user.rol || '').toUpperCase();
  const badge  = [rol, plaza].filter(Boolean).join(' · ') || 'Directorio';
  const peerKey = identity?.key || (email ? `EMAIL:${email}` : `LEGACY:${nombre.toUpperCase()}`);
  return `
<div class="am-contact am-contact--dir${isActive ? ' active' : ''}" data-peer="${esc(peerKey)}">
  <div class="am-contact-av">${esc(initials(nombre))}</div>
  <div class="am-contact-body">
    <div class="am-contact-top">
      <span class="am-contact-name">${esc(nombre)}</span>
    </div>
    <div class="am-contact-sub">${esc(badge)}</div>
    <div class="am-contact-snippet" style="color:#64748b;font-style:italic;">Iniciar conversación</div>
  </div>
</div>`;
}

export function renderEmptyContacts(isArchived, hasFilters) {
  if (isArchived) return '<div class="am-contacts-empty">No hay conversaciones archivadas.</div>';
  if (hasFilters) return '<div class="am-contacts-empty">No hay contactos que coincidan.</div>';
  return '<div class="am-contacts-empty">No hay contactos disponibles todavía.</div>';
}

export function renderStagingChip(type, data) {
  if (type === 'recording') {
    return `<div class="am-stage-chip recording"><span class="material-icons am-mic-pulse">mic</span><canvas id="amSpectrum" width="180" height="30"></canvas><span id="amRecTimer" class="am-rec-time">0:00</span><button class="am-stage-cancel" data-cancel="recording"><span class="material-icons">stop</span></button></div>`;
  }
  if (type === 'reply') {
    return `<div class="am-stage-chip reply"><span class="material-icons" style="color:#1d4ed8;font-size:16px;">reply</span><div style="flex:1;overflow:hidden;"><div style="font-size:10px;color:#1d4ed8;font-weight:800;">${esc(data.remitente)}</div><div style="font-size:11px;color:#475569;">${esc(String(data.mensaje || '').substring(0, 60))}</div></div><button class="am-stage-cancel" data-cancel="reply"><span class="material-icons">close</span></button></div>`;
  }
  if (type === 'file') {
    const preview = data.isImg && data.previewUrl
      ? `<img src="${data.previewUrl}" alt="preview" class="am-stage-thumb">`
      : `<span class="material-icons">insert_drive_file</span>`;
    return `<div class="am-stage-chip file">${preview}<span class="am-stage-name">${esc(data.file.name)}</span><span style="font-size:10px;color:#94a3b8;">${(data.file.size / 1024).toFixed(0)} KB</span><button class="am-stage-cancel" data-cancel="file"><span class="material-icons">close</span></button></div>`;
  }
  if (type === 'audio') {
    return `<div class="am-stage-chip audio"><span class="material-icons" style="color:#1d4ed8;">graphic_eq</span><audio controls src="${data.localUrl}" style="flex:1;height:32px;max-width:220px;"></audio><button class="am-stage-cancel" data-cancel="audio"><span class="material-icons">delete</span></button></div>`;
  }
  return '';
}
