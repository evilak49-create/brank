/* Colors follow the order background, surface, raised, border, text, muted, action, highlight and button text. */
window.cashClubPalettes = [
  {id:'amber', name:'曜石橙金', description:'炭黑打底，暖橙突出主操作，评分用浅金。', colors:['#101012','#19191B','#242225','#3A3430','#F7F3EE','#C4B6AB','#FFAA61','#FFC78D','#211408'], hero:['#191414','#B66C37']},
  {id:'crimson', name:'酒红香槟', description:'深酒红衬托香槟金，卡片带一点玫瑰底色。', colors:['#1C1016','#2B171F','#3A202C','#62404B','#FFF1F4','#D4AEBB','#EFC888','#FFD6A0','#29141B'], hero:['#201016','#933D58']},
  {id:'jade', name:'翡翠金', description:'松墨绿配金色主按钮，评分和图标用浅翡翠。', colors:['#0B1815','#10251E','#18352B','#2B4A3E','#EEF9F1','#A6C1B2','#F1C276','#99E0B8','#231706'], hero:['#0C1C16','#287958']},
  {id:'purple', name:'皇家紫晶', description:'深紫配薰衣草高亮，按钮与榜单用同一紫色系。', colors:['#161021','#211733','#302244','#4B3862','#F8F1FF','#C1B2D2','#BB9AFF','#D6BEFF','#201236'], hero:['#1B102C','#774BB1']},
  {id:'cobalt', name:'钴蓝电光', description:'午夜蓝背景配亮钴蓝按钮，榜单用冰蓝数字。', colors:['#10182A','#16233A','#1C2F4B','#344D70','#F2F6FF','#AFC0D9','#76A8FF','#A5C8FF','#0B1931'], hero:['#0E1B36','#335FC5']},
  {id:'cyan', name:'深海青蓝', description:'墨蓝叠加青色光晕，按钮和评分偏清透。', colors:['#08171C','#0D252C','#15343C','#29505A','#EAFAFF','#A0C2CB','#57D6E3','#93EDF3','#092228'], hero:['#081D27','#177F9D']},
  {id:'magenta', name:'霓虹莓粉', description:'黑莓紫配明亮莓粉按钮，适合偏夜场的视觉。', colors:['#180F19','#2A172A','#392039','#573651','#FFF0FA','#D3AEC8','#FF82CA','#FFAFDF','#2C1027'], hero:['#1E1020','#B93586']},
  {id:'lime', name:'碳黑酸柠', description:'冷灰卡片配酸柠绿，按钮和名次的反差强。', colors:['#121512','#1B201B','#262D25','#3D4A39','#F1F7EB','#B5C0AB','#CAEF71','#DAF694','#1A240E'], hero:['#151F13','#718F27']},
  {id:'copper', name:'赤铜焦糖', description:'咖啡棕搭配赤铜橙，整套偏暖、饱和度更低。', colors:['#211713','#30231D','#423128','#614838','#FFF4EB','#D3BDB0','#EAA57E','#FFBDA0','#2A1710'], hero:['#271912','#9E5235']},
  {id:'ivory', name:'象牙金', description:'象牙白底、温灰卡片，深金棕承载评分和链接。', colors:['#F5F0E6','#FFFCF5','#ECE3D1','#D6CAB2','#2B2418','#615341','#8A551C','#754713','#FFFFFF'], hero:['#262017','#9E7431'], light:true}
];

const requestedPalette = new URLSearchParams(location.search).get('theme');
const activePalette = window.cashClubPalettes.find(palette => palette.id===requestedPalette);
if (activePalette && document.documentElement.hasAttribute('data-home-palettes')) {
  const root = document.documentElement;
  root.dataset.palette = activePalette.light ? 'light' : 'dark';
  const tokens = ['base','surface','raised','line','text','muted','accent','highlight','on-accent'];
  for (const [index, token] of tokens.entries()) root.style.setProperty('--palette-'+token,activePalette.colors[index]);
  root.style.setProperty('--palette-hero',activePalette.hero[0]);
  root.style.setProperty('--palette-glow',activePalette.hero[1]);
}
