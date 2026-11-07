/** Draws a hat on a point at the top of a soldier's head. Facing flips hats that have a front. */
export function drawHat(c: CanvasRenderingContext2D, hat: string, x: number, y: number, color: string, facing = 1): void {
  c.save();
  c.translate(x, y);
  c.scale(facing < 0 ? -1 : 1, 1);
  c.lineWidth = 1.8;
  c.lineJoin = 'round';
  c.strokeStyle = color;
  c.fillStyle = color;
  switch (hat) {
    case 'cap':
      c.beginPath();
      c.moveTo(-8, -1);
      c.lineTo(0, -5);
      c.lineTo(8, -1);
      c.lineTo(0, 2);
      c.closePath();
      c.fill();
      c.beginPath();
      c.moveTo(6, -1);
      c.lineTo(7, 4);
      c.stroke();
      break;
    case 'cone':
      c.fillStyle = '#f7e64a';
      c.beginPath();
      c.moveTo(-5, 1);
      c.lineTo(0, -10);
      c.lineTo(5, 1);
      c.closePath();
      c.fill();
      c.stroke();
      break;
    case 'crown':
      c.fillStyle = '#f2c230';
      c.beginPath();
      c.moveTo(-6, 1);
      c.lineTo(-6, -6);
      c.lineTo(-2.5, -2);
      c.lineTo(0, -7);
      c.lineTo(2.5, -2);
      c.lineTo(6, -6);
      c.lineTo(6, 1);
      c.closePath();
      c.fill();
      c.stroke();
      break;
    case 'wizard':
      c.beginPath();
      c.moveTo(-9, 1);
      c.lineTo(9, 1);
      c.stroke();
      c.beginPath();
      c.moveTo(-5, 1);
      c.quadraticCurveTo(-1, -7, 4, -13);
      c.quadraticCurveTo(3, -5, 5, 1);
      c.closePath();
      c.fill();
      break;
    case 'halo':
      c.beginPath();
      c.ellipse(0, -5, 7.5, 2.6, 0, 0, Math.PI * 2);
      c.strokeStyle = '#e0a800';
      c.lineWidth = 2.2;
      c.stroke();
      break;
    case 'top':
      c.fillStyle = '#23232e';
      c.strokeStyle = '#23232e';
      c.beginPath();
      c.moveTo(-8, 1);
      c.lineTo(8, 1);
      c.stroke();
      c.fillRect(-5, -10, 10, 11);
      c.fillStyle = '#d62f3a';
      c.fillRect(-5, -2.5, 10, 2.5);
      break;
    case 'bow':
      c.fillStyle = '#ff5d8f';
      c.strokeStyle = '#c92c5b';
      c.lineWidth = 1.2;
      c.beginPath();
      c.moveTo(0, -1);
      c.lineTo(-7, -5);
      c.lineTo(-7, 3);
      c.closePath();
      c.moveTo(0, -1);
      c.lineTo(7, -5);
      c.lineTo(7, 3);
      c.closePath();
      c.fill();
      c.stroke();
      c.beginPath();
      c.arc(0, -1, 1.8, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      break;
    case 'headphones':
      c.strokeStyle = '#23232e';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(0, 5, 9, Math.PI * 1.08, Math.PI * 1.92);
      c.stroke();
      c.fillStyle = '#ff4d7e';
      c.fillRect(-10, 2, 3.2, 6.5);
      c.fillRect(6.8, 2, 3.2, 6.5);
      break;
    case 'propeller':
      c.fillStyle = '#3f8cff';
      c.beginPath();
      c.arc(0, 1, 6, Math.PI, 0);
      c.closePath();
      c.fill();
      c.fillStyle = '#ffd33d';
      c.beginPath();
      c.arc(0, 1, 6, Math.PI, Math.PI * 1.5);
      c.lineTo(0, 1);
      c.closePath();
      c.fill();
      c.strokeStyle = '#23232e';
      c.lineWidth = 1.4;
      c.beginPath();
      c.moveTo(0, -5);
      c.lineTo(0, -8);
      c.stroke();
      c.strokeStyle = '#ff4d7e';
      c.lineWidth = 2.2;
      c.beginPath();
      c.moveTo(-7, -9);
      c.lineTo(7, -7.5);
      c.stroke();
      break;
    case 'pirate':
      c.fillStyle = '#23232e';
      c.beginPath();
      c.moveTo(-10, 1);
      c.quadraticCurveTo(0, -13, 10, 1);
      c.quadraticCurveTo(0, -3, -10, 1);
      c.closePath();
      c.fill();
      c.fillStyle = '#ffffff';
      c.beginPath();
      c.arc(0, -4, 1.6, 0, Math.PI * 2);
      c.fill();
      break;
    case 'santa':
      c.fillStyle = '#d62f3a';
      c.beginPath();
      c.moveTo(-6, 0);
      c.quadraticCurveTo(0, -11, 8, -5);
      c.lineTo(6, 0);
      c.closePath();
      c.fill();
      c.fillStyle = '#ffffff';
      c.fillRect(-7, -1, 14, 3);
      c.beginPath();
      c.arc(8.5, -4.5, 2, 0, Math.PI * 2);
      c.fill();
      break;
    case 'viking':
      c.fillStyle = '#8d939e';
      c.beginPath();
      c.arc(0, 1, 6.5, Math.PI, 0);
      c.closePath();
      c.fill();
      c.fillStyle = '#f3ead2';
      c.strokeStyle = '#a8996f';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(-6, -1);
      c.quadraticCurveTo(-10, -2, -10, -8);
      c.quadraticCurveTo(-7, -4, -4, -4);
      c.closePath();
      c.moveTo(6, -1);
      c.quadraticCurveTo(10, -2, 10, -8);
      c.quadraticCurveTo(7, -4, 4, -4);
      c.closePath();
      c.fill();
      c.stroke();
      break;
    case 'leaf':
      c.strokeStyle = '#6b4a22';
      c.lineWidth = 1.6;
      c.beginPath();
      c.moveTo(0, 1);
      c.lineTo(0, -4);
      c.stroke();
      c.fillStyle = '#4faa5c';
      c.beginPath();
      c.moveTo(0, -3);
      c.quadraticCurveTo(3, -10, 9, -8);
      c.quadraticCurveTo(7, -2, 0, -3);
      c.closePath();
      c.fill();
      break;
    case 'beanie':
      c.fillStyle = '#3f8cff';
      c.beginPath();
      c.arc(0, 2, 7.5, Math.PI, 0);
      c.closePath();
      c.fill();
      c.stroke();
      c.fillStyle = '#ffffff';
      c.fillRect(-7.8, -0.5, 15.6, 3.2);
      c.strokeRect(-7.8, -0.5, 15.6, 3.2);
      c.fillStyle = '#ff5d7e';
      c.beginPath();
      c.arc(0, -6.8, 2.6, 0, Math.PI * 2);
      c.fill();
      break;
    case 'earmuffs':
      c.strokeStyle = '#5b5f73';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(0, 5, 8.6, Math.PI * 1.05, Math.PI * 1.95);
      c.stroke();
      c.fillStyle = '#ff8cc2';
      c.strokeStyle = color;
      c.lineWidth = 1.2;
      for (const sx of [-8.4, 8.4]) {
        c.beginPath();
        c.arc(sx, 6.5, 3.4, 0, Math.PI * 2);
        c.fill();
        c.stroke();
      }
      break;
    case 'elf':
      c.fillStyle = '#2f9e44';
      c.beginPath();
      c.moveTo(-6, 1);
      c.quadraticCurveTo(1, -8, 11, -8);
      c.quadraticCurveTo(4, -3, 6, 1);
      c.closePath();
      c.fill();
      c.stroke();
      c.fillStyle = '#d62f3a';
      c.fillRect(-7, -1, 14, 3);
      c.fillStyle = '#ffd33d';
      c.beginPath();
      c.arc(11.5, -8, 2, 0, Math.PI * 2);
      c.fill();
      break;
    case 'chef':
      c.fillStyle = '#ffffff';
      c.strokeStyle = '#9aa0b4';
      c.lineWidth = 1.2;
      c.beginPath();
      c.arc(-4, -5, 4, 0, Math.PI * 2);
      c.arc(4, -5, 4, 0, Math.PI * 2);
      c.moveTo(4, -8);
      c.arc(0, -8, 4.5, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.fillRect(-5.5, -4, 11, 5);
      c.strokeRect(-5.5, -4, 11, 5);
      break;
    case 'reindeer':
      c.strokeStyle = '#8a5a2b';
      c.lineWidth = 1.8;
      c.lineCap = 'round';
      c.beginPath();
      for (const sx of [-1, 1]) {
        c.moveTo(3.5 * sx, 1);
        c.lineTo(6.5 * sx, -8);
        c.moveTo(5.5 * sx, -4.5);
        c.lineTo(9.5 * sx, -6);
        c.moveTo(6.5 * sx, -8);
        c.lineTo(9 * sx, -11);
        c.moveTo(6.5 * sx, -8);
        c.lineTo(4.5 * sx, -11);
      }
      c.stroke();
      break;
    case 'astronaut':
      // A clear bubble around the whole head.
      c.fillStyle = 'rgba(170, 215, 255, 0.28)';
      c.strokeStyle = '#c9d6ea';
      c.lineWidth = 1.8;
      c.beginPath();
      c.arc(0, 6, 10.5, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      c.lineWidth = 1.4;
      c.beginPath();
      c.arc(0, 6, 8, Math.PI * 1.15, Math.PI * 1.45);
      c.stroke();
      c.strokeStyle = '#c9d6ea';
      c.beginPath();
      c.moveTo(3, -4);
      c.lineTo(5, -9);
      c.stroke();
      c.fillStyle = '#ff5d7e';
      c.beginPath();
      c.arc(5, -9.5, 1.6, 0, Math.PI * 2);
      c.fill();
      break;
    default:
      break;
  }
  c.restore();
}
