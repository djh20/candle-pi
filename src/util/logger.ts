class Logger {
  public history: string[];

  constructor() {
    this.history = [];
  }

  info(topic: string, msg: any) {
    this.send("info", topic, msg);
  }

  warn(topic: string, msg: any) {
    this.send("!warn", topic, msg);
  }

  error(topic: string, msg: any) {
    this.send("!!error", topic, msg);
  }

  private send(prefix: string, topic: string, content: any) {
    const msg = `${prefix}:${topic}  ${content}`;
    console.log(msg);
    this.history.push(msg);
    //this.history.push({type:type, topic:topic, message:msg});
  }
}
/*
interface LogMessage {
  type: string;
  topic: string;
  message: string;
}
*/
export default new Logger();