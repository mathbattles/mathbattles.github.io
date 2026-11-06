/** Draws a hat sitting on a point at the top of a soldier's head. */
export function drawHat(c: CanvasRenderingContext2D, hat: string, x: number, y: number, color: string): void {
  c.save();
  c.lineWidth = 1.8;
  c.strokeStyle = color;
  c.fillStyle = color;
  switch (hat) {
    case 'cap':
      c.beginPath();
      c.moveTo(x - 8, y - 1);
      c.lineTo(x, y - 5);
      c.lineTo(x + 8, y - 1);
      c.lineTo(x, y + 2);
      c.closePath();
      c.fill();
      c.beginPath();
      c.moveTo(x + 6, y - 1);
      c.lineTo(x + 7, y + 4);
      c.stroke();
      break;
    case 'cone':
      c.fillStyle = '#f7e64a';
      c.beginPath();
      c.moveTo(x - 5, y + 1);
      c.lineTo(x, y - 10);
      c.lineTo(x + 5, y + 1);
      c.closePath();
      c.fill();
      c.stroke();
      break;
    case 'crown':
      c.fillStyle = '#f2c230';
      c.beginPath();
      c.moveTo(x - 6, y + 1);
      c.lineTo(x - 6, y - 6);
      c.lineTo(x - 2.5, y - 2);
      c.lineTo(x, y - 7);
      c.lineTo(x + 2.5, y - 2);
      c.lineTo(x + 6, y - 6);
      c.lineTo(x + 6, y + 1);
      c.closePath();
      c.fill();
      c.stroke();
      break;
    case 'wizard':
      c.beginPath();
      c.moveTo(x - 9, y + 1);
      c.lineTo(x + 9, y + 1);
      c.stroke();
      c.beginPath();
      c.moveTo(x - 5, y + 1);
      c.quadraticCurveTo(x - 1, y - 7, x + 4, y - 13);
      c.quadraticCurveTo(x + 3, y - 5, x + 5, y + 1);
      c.closePath();
      c.fill();
      break;
    case 'halo':
      c.beginPath();
      c.ellipse(x, y - 5, 7.5, 2.6, 0, 0, Math.PI * 2);
      c.strokeStyle = '#e0a800';
      c.lineWidth = 2.2;
      c.stroke();
      break;
    default:
      break;
  }
  c.restore();
}
