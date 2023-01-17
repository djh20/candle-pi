class Logger {
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
  }
}

export default new Logger();