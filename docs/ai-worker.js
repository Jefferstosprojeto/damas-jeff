/* Web Worker: o computador pensa aqui para a página não travar. */
importScripts("engine.js", "ai.js");

self.onmessage = ({ data }) => {
  const board = self.DamasEngine.Board.fromJSON(data.board);
  const move = self.DamasAI.chooseMove(board, data.level);
  self.postMessage({ id: data.id, path: move.path });
};
