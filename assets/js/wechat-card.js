/**
 * Lightweight controller for the sidebar WeChat card.
 * Apple-like popover with click-to-copy support.
 */
(function () {
  const cards = Array.prototype.slice.call(document.querySelectorAll(".wechat-card"));
  if (!cards.length) return;

  const closeAll = () => {
    cards.forEach((card) => {
      card.classList.remove("is-open");
      const trigger = card.querySelector(".wechat-card__trigger");
      if (trigger) {
        trigger.setAttribute("aria-expanded", "false");
      }
    });
  };

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".wechat-card")) {
      closeAll();
    }
  });

  cards.forEach((card) => {
    const trigger = card.querySelector(".wechat-card__trigger");
    const copyBtn = card.querySelector(".wechat-card__copy");

    if (trigger) {
      trigger.addEventListener("click", (event) => {
        event.preventDefault();
        const isOpen = card.classList.contains("is-open");
        closeAll();
        if (!isOpen) {
          card.classList.add("is-open");
          trigger.setAttribute("aria-expanded", "true");
        }
      });
    }

    if (copyBtn) {
      copyBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        const value = copyBtn.getAttribute("data-wechat") || "";
        if (!value) return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(value).catch(() => {});
        } else {
          const tempInput = document.createElement("input");
          tempInput.value = value;
          document.body.appendChild(tempInput);
          tempInput.select();
          try {
            document.execCommand("copy");
          } catch (e) {
            // no-op
          }
          document.body.removeChild(tempInput);
        }
      });
    }
  });
})();
