const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('trayBridge',{
  state:()=>ipcRenderer.invoke('tray:state'),
  execute:action=>ipcRenderer.invoke('tray:execute',action),
  command:command=>ipcRenderer.invoke('tray:command',command),
  onChange:callback=>ipcRenderer.on('tray:changed',(_,state)=>callback(state))
});
