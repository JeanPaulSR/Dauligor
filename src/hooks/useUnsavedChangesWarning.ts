import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export function useUnsavedChangesWarning(isDirty: boolean) {
  const navigate = useNavigate();

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  // Handle in-app navigation mapping to standard <a> tags
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (!isDirty) return;
      
      const target = e.target as HTMLElement;
      const anchor = target.closest('a');
      
      const path = window.location.pathname;
      
      if (anchor && anchor.href && !anchor.hasAttribute('target')) {
        const targetUrl = new URL(anchor.href, window.location.origin);
        if (targetUrl.pathname !== path) {
          e.preventDefault();
          e.stopPropagation();

          // Check if modal already exists
          if (document.getElementById('unsaved-changes-modal')) return;

          const modalOverlay = document.createElement('div');
          modalOverlay.id = 'unsaved-changes-modal';
          modalOverlay.className = "fixed inset-0 z-[9999] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200";
          
          const modalContent = document.createElement('div');
          modalContent.className = "bg-card border border-gold/20 shadow-2xl rounded-xl p-6 max-w-md w-full animate-in zoom-in-95 duration-200 pointer-events-auto";
          // Prevent clicks inside the modal from bubbling up and triggering the listener again
          modalContent.onclick = (ev) => ev.stopPropagation();
          
          const title = document.createElement('h3');
          title.className = "text-xl font-serif font-bold text-gold mb-2";
          title.textContent = "Unsaved Changes";
          
          const msg = document.createElement('p');
          msg.className = "text-ink/80 mb-6 font-sans text-sm";
          msg.textContent = "You have unsaved changes. Are you sure you want to leave? Your changes will be lost.";
          
          const buttonContainer = document.createElement('div');
          buttonContainer.className = "flex justify-end gap-3 font-sans text-sm";
          
          const cancelBtn = document.createElement('button');
          cancelBtn.type = "button";
          cancelBtn.className = "px-4 py-2 rounded-md border border-ink/20 text-ink/80 hover:bg-ink/5 transition-colors";
          cancelBtn.textContent = "Cancel";
          cancelBtn.onclick = () => {
            document.body.removeChild(modalOverlay);
          };
          
          const leaveBtn = document.createElement('button');
          leaveBtn.type = "button";
          leaveBtn.className = "px-4 py-2 rounded-md bg-red-900/80 text-red-100 hover:bg-red-900 transition-colors border border-red-900/50";
          leaveBtn.textContent = "Leave Without Saving";
          leaveBtn.onclick = () => {
            document.body.removeChild(modalOverlay);
            navigate(targetUrl.pathname + targetUrl.search + targetUrl.hash);
          };
          
          buttonContainer.appendChild(cancelBtn);
          buttonContainer.appendChild(leaveBtn);
          
          modalContent.appendChild(title);
          modalContent.appendChild(msg);
          modalContent.appendChild(buttonContainer);
          modalOverlay.appendChild(modalContent);
          
          document.body.appendChild(modalOverlay);
        }
      }
    };

    // Use capture phase to ensure we intercept before the router does
    document.addEventListener('click', handleClick, { capture: true });
    return () => document.removeEventListener('click', handleClick, { capture: true });
  }, [isDirty, navigate]);
}
