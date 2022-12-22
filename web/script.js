const commandInput = document.getElementById("command");
const sendButton = document.getElementById("send");
const statusLabel = document.getElementById("status");

const ws = new WebSocket(`ws://${location.host}/ws`);

ws.onopen = () => {
  statusLabel.innerHTML = "Connected!";
}

ws.onclose = () => {
  statusLabel.innerHTML = "Not connected, refresh and try again...";
}

sendButton.addEventListener("click", (e) => {
  sendCommand();
});

commandInput.addEventListener("keyup", (e) => {
  if (e.key == "Enter") {
    sendCommand();
  }
});

function sendCommand() {
  const value = commandInput.value;
  if (value) {
    ws.send(
      JSON.stringify({
        event: "command",
        command: value
      })
    );
    //commandInput.value = "";
  }
}