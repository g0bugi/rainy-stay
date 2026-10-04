// All positions are measured in the original asset, not screen coordinates.
// Physical masks stay aligned when a portrait viewport crops or pans the scene.
import { roomMasks } from './assets/scene-masks.js';
export const order = ['bed', 'window', 'sofa', 'table'];
export const scenes = {
  bed: { name: '침대', title: '비가 머무는 침대', eyebrow: '01 / 04 · 이불 속에서', description: '아무것도 하지 않아도 괜찮은 밤.', image: './assets/bed.webp', focal: .55, alt: '침대에 누운 낮은 시선. 눈앞의 포근한 이불 너머로 비 오는 숲과 창가 소파, 작은 차 테이블.', primary: '이불 덮기' },
  window: { name: '창가', title: '숲과 가장 가까운 자리', eyebrow: '02 / 04 · 창가에서', description: '유리 위로, 빗방울이 천천히 흘러요.', image: './assets/window.webp', focal: .38, alt: '큰 창가 가까이에서 바라보는 빗방울과 안개 낀 숲. 오른쪽에는 같은 소파와 차 테이블.', primary: '비에 귀 기울이기' },
  sofa: { name: '소파', title: '조금 더 느린 밤', eyebrow: '03 / 04 · 소파에 기대어', description: '담요의 온기와, 조용히 흐르는 화면.', image: './assets/sofa.webp', focal: .45, alt: '소파 위 담요 너머로 바라보는 같은 침대와 작은 TV, 차 테이블과 비 오는 숲.', primary: 'TV 끄기' },
  table: { name: '차 한 잔', title: '온기를 두 손에', eyebrow: '04 / 04 · 차 한 잔 앞에서', description: '따뜻한 차에서 오늘의 속도를 내려놓아요.', image: './assets/table.webp', focal: .58, alt: '차 테이블 가까이에서 바라보는 도자기 머그와 주전자. 뒤에는 같은 침대, 숲 창과 소파.', primary: '차 데우기' },
};
for (const key of order) Object.assign(scenes[key], roomMasks[key]);
export function coverGeometry(width, height, naturalWidth, naturalHeight, pan = .5, zoom = 1) {
  const scale = Math.max(width / naturalWidth, height / naturalHeight) * zoom;
  const w = naturalWidth * scale, h = naturalHeight * scale;
  return { width: w, height: h, x: -(w - width) * Math.max(0, Math.min(1, pan)), y: -(h - height) * .5, scale };
}
export function toScreen(point, geometry) {
  return [geometry.x + point[0] * geometry.width, geometry.y + point[1] * geometry.height];
}
