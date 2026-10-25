import { describe, expect, it } from 'vitest';
import { variantWidths } from './images.js';

describe('variantWidths', () => {
  it('добавляет исходную ширину, если она между ступенями сетки', () => {
    // Раньше было [320, 640] — и сайт растягивал 640 на колонку в 720
    expect(variantWidths(900)).toEqual([320, 640, 900]);
  });

  it('не дублирует ступень, совпадающую с исходником', () => {
    expect(variantWidths(1280)).toEqual([320, 640, 960, 1280]);
  });

  it('пропускает ступень, почти равную исходнику', () => {
    expect(variantWidths(1300)).toEqual([320, 640, 960, 1300]);
  });

  it('маленькая картинка — один вариант в своём размере', () => {
    expect(variantWidths(200)).toEqual([200]);
  });

  it('шире сетки — только сетка', () => {
    expect(variantWidths(2560)).toEqual([320, 640, 960, 1280, 1920]);
  });
});
