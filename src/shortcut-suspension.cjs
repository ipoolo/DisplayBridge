const {randomUUID}=require('node:crypto');
class ShortcutSuspension{
  constructor(refresh){this.refresh=refresh;this.token=null;}
  get active(){return this.token!==null;}
  begin(){if(!this.token){this.token=randomUUID();this.refresh();}return this.token;}
  end(token){if(token!==this.token)return false;return this.reset();}
  reset(){if(!this.token)return false;this.token=null;this.refresh();return true;}
}
module.exports={ShortcutSuspension};
