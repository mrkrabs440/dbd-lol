import * as THREE from 'three';

// ===========================================================================
// 맵 컨셉 정의
// ---------------------------------------------------------------------------
// 방마다 서버가 이 중 하나를 골라 매치 스냅샷(mapConcept)으로 내려준다.
// 클라이언트는 buildMap() 에서 해당 컨셉의 바닥/벽/오브젝트/조명을 만든다.
// 발전기/게이트 좌표도 컨셉마다 달라진다.
// ===========================================================================

export const MAP_CONCEPTS = [
  {
    id: 'ruins',
    name: '폐허 학교',
    desc: '붕괴된 교실과 복도. 낡은 나무와 콘크리트 잔해.',
    fog: 0x0a0d12,
    fogDensity: 0.028,
    floor: 0x14161a,
    floorRough: 0.98,
    wall: 0x22242a,
    wallHeight: 4.2,
    ambient: 0x2a3444,
    ambientIntensity: 0.55,
    hemi: 0x3b4a63,
    prop: 'rubble',
    propColor: 0x2a2d33,
    obstacles: [
      { x: -10, z: -8, w: 6, h: 2.6, d: 1.2, rot: 0 },
      { x: 10, z: -8, w: 6, h: 2.6, d: 1.2, rot: 0 },
      { x: -10, z: 9, w: 1.2, h: 2.6, d: 6, rot: 0 },
      { x: 10, z: 9, w: 1.2, h: 2.6, d: 6, rot: 0 },
      { x: 0, z: 0, w: 4.2, h: 2.4, d: 4.2, rot: 0.4 },
      { x: -16, z: 1, w: 1.6, h: 1.8, d: 7, rot: 0 },
      { x: 16, z: 1, w: 1.6, h: 1.8, d: 7, rot: 0 },
      { x: -4, z: -18, w: 5, h: 1.4, d: 1.2, rot: 0.3 },
      { x: 6, z: 18, w: 5, h: 1.4, d: 1.2, rot: -0.2 },
    ],
    trees: 6,
    lamps: 4,
  },
  {
    id: 'forest',
    name: '월동 숲',
    desc: '안개 낀 침엽수 숲. 나무 사이로 시야가 좁다.',
    fog: 0x0c1410,
    fogDensity: 0.042,
    floor: 0x121a13,
    floorRough: 1,
    wall: 0x1a231c,
    wallHeight: 5,
    ambient: 0x1d3326,
    ambientIntensity: 0.45,
    hemi: 0x2f4a36,
    prop: 'tree',
    propColor: 0x1b2a1f,
    obstacles: [
      { x: -8, z: -12, w: 1.4, h: 5, d: 1.4, rot: 0 },
      { x: 8, z: -12, w: 1.4, h: 5, d: 1.4, rot: 0 },
      { x: -14, z: 4, w: 1.6, h: 5.2, d: 1.6, rot: 0 },
      { x: 14, z: 4, w: 1.6, h: 5.2, d: 1.6, rot: 0 },
      { x: 0, z: 0, w: 2.2, h: 4.4, d: 2.2, rot: 0 },
      { x: -18, z: -16, w: 1.4, h: 5, d: 1.4, rot: 0 },
      { x: 18, z: -16, w: 1.4, h: 5, d: 1.4, rot: 0 },
      { x: -18, z: 16, w: 1.4, h: 5, d: 1.4, rot: 0 },
      { x: 18, z: 16, w: 1.4, h: 5, d: 1.4, rot: 0 },
      { x: 0, z: 20, w: 6, h: 1.2, d: 1.2, rot: 0.2 },
      { x: 2, z: -20, w: 6, h: 1.2, d: 1.2, rot: -0.2 },
    ],
    trees: 22,
    lamps: 2,
  },
  {
    id: 'factory',
    name: '폐공장',
    desc: '기계와 컨베이어 벨트가 있는 산업 시설. 시야가 트인다.',
    fog: 0x120e0a,
    fogDensity: 0.024,
    floor: 0x181614,
    floorRough: 0.7,
    wall: 0x2b2724,
    wallHeight: 4.6,
    ambient: 0x3a2c22,
    ambientIntensity: 0.5,
    hemi: 0x4a3a2c,
    prop: 'machine',
    propColor: 0x302a26,
    obstacles: [
      { x: -12, z: -10, w: 7, h: 2.2, d: 2.4, rot: 0 },
      { x: 12, z: -10, w: 7, h: 2.2, d: 2.4, rot: 0 },
      { x: -12, z: 10, w: 2.4, h: 2.2, d: 7, rot: 0 },
      { x: 12, z: 10, w: 2.4, h: 2.2, d: 7, rot: 0 },
      { x: 0, z: 0, w: 3.4, h: 2.8, d: 3.4, rot: 0.5 },
      { x: -20, z: 0, w: 1.6, h: 3.2, d: 9, rot: 0 },
      { x: 20, z: 0, w: 1.6, h: 3.2, d: 9, rot: 0 },
      { x: -6, z: -20, w: 8, h: 1.6, d: 2, rot: 0 },
      { x: 6, z: 20, w: 8, h: 1.6, d: 2, rot: 0 },
    ],
    trees: 0,
    lamps: 6,
  },
];

// 컨셉별 발전기/게이트 좌표 (서버와 동일한 값이어야 한다)
export const CONCEPT_LAYOUT = {
  ruins: {
    generators: [
      { x: -20, y: 0, z: -20 },
      { x: 20, y: 0, z: -20 },
      { x: 0, y: 0, z: 21 },
    ],
    gates: [
      { x: 0, y: 0, z: -28 },
      { x: 0, y: 0, z: 28 },
    ],
  },
  forest: {
    generators: [
      { x: -22, y: 0, z: -6 },
      { x: 22, y: 0, z: 6 },
      { x: 0, y: 0, z: -24 },
    ],
    gates: [
      { x: -26, y: 0, z: 18 },
      { x: 26, y: 0, z: -18 },
    ],
  },
  factory: {
    generators: [
      { x: -18, y: 0, z: -22 },
      { x: 18, y: 0, z: -22 },
      { x: 0, y: 0, z: 24 },
    ],
    gates: [
      { x: 0, y: 0, z: -28 },
      { x: 26, y: 0, z: 26 },
    ],
  },
};

export function getConcept(id) {
  return MAP_CONCEPTS.find((c) => c.id === id) || MAP_CONCEPTS[0];
}
