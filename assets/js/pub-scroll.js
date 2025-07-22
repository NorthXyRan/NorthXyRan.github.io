/* publications 图片自适应滚动 (增强版，含logo/文字缩放) */
(function(){
  const pubs = Array.from(document.querySelectorAll('.publication'));
  const imgs = pubs.map(p=>p.querySelector('.publication__main-image'));
  if (!imgs.length) return;

  // 辅助函数：根据激活布尔设置尺寸
  function setActive(pub, isActive){
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

  // 初始化：首条激活
  pubs.forEach((p,i)=> setActive(p, i===0));

  // IntersectionObserver
  const io = new IntersectionObserver(entries=>{
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