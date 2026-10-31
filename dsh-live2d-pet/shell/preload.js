// 渲染层能用的外壳能力：拖窗口、改大小、菜单、收起、聊天、统计。
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('petShell', {
  moveBy: (dx, dy) => ipcRenderer.invoke('pet:move-by', { dx, dy }),
  resizeBy: (dx, dy) => ipcRenderer.invoke('pet:resize-by', { dx, dy }),
  setWidth: (width) => ipcRenderer.invoke('pet:set-width', { width }),
  currentSize: () => ipcRenderer.invoke('pet:size'),
  openMenu: () => ipcRenderer.invoke('pet:menu'),
  setCollapsed: (collapsed) => ipcRenderer.invoke('pet:set-collapsed', { collapsed }),
  chatSend: (text) => ipcRenderer.invoke('pet:chat-send', { text }),
  chatRead: () => ipcRenderer.invoke('pet:chat-read'),
  stats: () => ipcRenderer.invoke('pet:stats'),
})
