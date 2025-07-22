/* publications 图片自适应滚动 */
(function(){
  const imgs = Array.from(document.querySelectorAll('.publication__main-image'));
  if (!imgs.length) return;

  // 初始化：首图 1200px，其余 900px
  imgs.forEach((img,i)=> img.style.width = i ? '900px' : '1200px');

  // IntersectionObserver 监听
  const io = new IntersectionObserver(entries=>{
    entries.forEach(e=>{
      if(!e.isIntersecting) return;
      imgs.forEach(img=>{
        img.style.width = (img===e.target) ? '1200px' : '900px';
      });
    });
  },{
    root:null,
    rootMargin:'-40% 0px', // 视口中心 20% 区域
    threshold:0
  });

  imgs.forEach(img=> io.observe(img));
})(); 