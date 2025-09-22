/* publications 图片自适应滚动 (增强版，含logo/文字缩放) */
(function(){
  const pubs = Array.from(document.querySelectorAll('.publication'));
  const imgs = pubs.map(p=>p.querySelector('.publication__main-image'));
  if (!imgs.length) return;

  // 检查是否为大屏幕 (769px+)
  function isDesktop() {
    return window.matchMedia('(min-width: 769px)').matches;
  }

  // 辅助函数：根据激活布尔设置尺寸
  function setActive(pub, isActive){
    // 只在大屏幕时应用动画效果
    if (!isDesktop()) return;
    
    const img   = pub.querySelector('.publication__main-image');
    const logo  = pub.querySelector('.publication__conference-logo');
    const author= pub.querySelector('.publication__authors');
    const label = pub.querySelector('.publication__label');
    const abs   = pub.querySelector('.publication__abstract');

    if(img)   img.style.width   = isActive ? '1200px' : '900px';
    if(logo)  logo.style.setProperty('height', isActive ? '150px' : '100px', 'important');

    const big = isActive ? 24 : 20; // active 基准24px, 否则-4
    if(author) author.style.setProperty('font-size', big + 'px', 'important');
    if(label)  label.style.setProperty('font-size', big + 'px', 'important');
    if(abs)    abs.style.setProperty('font-size', big + 'px', 'important');
  }

  // 重置移动端样式
  function resetMobileStyles() {
    if (isDesktop()) return;
    
    pubs.forEach(pub => {
      const img   = pub.querySelector('.publication__main-image');
      const logo  = pub.querySelector('.publication__conference-logo');
      const author= pub.querySelector('.publication__authors');
      const label = pub.querySelector('.publication__label');
      const abs   = pub.querySelector('.publication__abstract');

      // 清除动态设置的样式，让CSS媒体查询生效
      if(img) img.style.width = '';
      if(logo) logo.style.removeProperty('height');
      if(author) author.style.removeProperty('font-size');
      if(label) label.style.removeProperty('font-size');
      if(abs) abs.style.removeProperty('font-size');
    });
  }

  // 初始化
  function init() {
    if (isDesktop()) {
      // 大屏幕：首条激活
      pubs.forEach((p,i)=> setActive(p, i===0));
    } else {
      // 移动端：重置样式
      resetMobileStyles();
    }
  }

  // 监听屏幕尺寸变化
  const mediaQuery = window.matchMedia('(min-width: 769px)');
  mediaQuery.addListener(init);

  // 初始化
  init();

  // IntersectionObserver (只在大屏幕时启用)
  const io = new IntersectionObserver(entries=>{
    if (!isDesktop()) return;
    
    entries.forEach(e=>{
      if(!e.isIntersecting) return;
      pubs.forEach(pub=> setActive(pub, pub.contains(e.target)));
    });
  },{
    root:null,
    rootMargin:'-40% 0px',
    threshold:0
  });

  imgs.forEach(img=> io.observe(img));
})(); 