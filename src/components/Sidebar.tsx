import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { fetchDocument } from '../lib/d1';
import { ScrollArea } from './ui/scroll-area';
import { Button } from './ui/button';
import { 
  BookOpen, Map as MapIcon, Users, Bookmark, History, Calendar,
  Clock, Book, Shield, Dna, Bug, Scroll, Sword, Wand2,
  Hammer, Bed, ChevronRight, ChevronDown, PanelLeftClose, PanelLeftOpen,
  Plus, Image as ImageIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

export default function Sidebar({ 
  userProfile, 
  isOpen, 
  onClose,
  isCollapsed,
  onToggleCollapse
}: { 
  userProfile: any,
  isOpen?: boolean,
  onClose?: () => void,
  isCollapsed: boolean,
  onToggleCollapse: () => void
}) {
  const [campaign, setCampaign] = useState<any>(null);
  const [recentArticles, setRecentArticles] = useState<any[]>([]);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    world: true,
    time: true,
    game: true
  });
  
  const navigate = useNavigate();
  const location = useLocation();

  const isStaff = userProfile?.role === 'admin' || userProfile?.role === 'co-dm' || userProfile?.role === 'lore-writer';
  const isAdmin = userProfile?.role === 'admin';

  useEffect(() => {
    const fetchCampaign = async () => {
      try {
        if (userProfile?.active_campaign_id) {
          const data = await fetchDocument<any>('campaigns', userProfile.active_campaign_id);
          if (data) {
            setCampaign(data);
          }
        } else {
          setCampaign(null);
        }
      } catch (error) {
        console.error("Error fetching campaign in sidebar:", error);
      }
    };
    fetchCampaign();
  }, [userProfile?.active_campaign_id]);

  useEffect(() => {
    const loadHistory = () => {
      try {
        const historyStr = localStorage.getItem('articleHistory');
        if (historyStr) {
          setRecentArticles(JSON.parse(historyStr));
        }
      } catch (e) {
        console.error("Failed to load article history", e);
      }
    };

    loadHistory();
    window.addEventListener('articleHistoryUpdated', loadHistory);
    return () => window.removeEventListener('articleHistoryUpdated', loadHistory);
  }, []);

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const navItems = {
    world: [
      { label: 'Maps', icon: MapIcon, path: '/map' },
      { label: 'Locations', icon: MapIcon, path: '/wiki?category=geography' },
      { label: 'Organizations', icon: Shield, path: '/wiki?category=organization' },
      { label: 'Races', icon: Dna, path: '/wiki?category=species' },
      { label: 'Creatures', icon: Bug, path: '/wiki?category=species' },
      { label: 'NPCs', icon: Users, path: '/wiki?category=character' },
    ],
    time: [
      { label: 'History', icon: History, path: '/wiki?category=history' },
      { label: 'Calendars', icon: Calendar, path: '/wiki?category=calendar' },
      { label: 'Timelines', icon: Clock, path: '/wiki?category=timeline' },
      { label: 'Journals', icon: Book, path: '/wiki?category=session' },
    ],
    game: [
      { label: 'Characters', icon: Users, path: '/characters' },
      { 
        label: 'Compendium', 
        icon: BookOpen, 
        path: '/compendium',
        subItems: [
          { label: 'Classes', path: '/compendium/classes' },
          { label: 'Spells', path: '/compendium/spells' },
          ...(isAdmin ? [
            { label: 'Feats', path: '/compendium/feats' },
            { label: 'Items', path: '/compendium/items' },
          ] : []),
        ]
      },
      { label: 'Rules', icon: Scroll, path: '/wiki?category=law' },
      { label: 'Sources', icon: Book, path: '/sources' },
      { label: 'Crafting', icon: Hammer, path: '/wiki?category=technology' },
      { label: 'Downtime', icon: Bed, path: '/wiki?category=generic' },
    ]
  };

  const renderNavItem = (item: any) => {
    const isActive = location.pathname === item.path || (item.path.startsWith('/wiki') && location.search.includes(item.path.split('?')[1]));
    
    if (isCollapsed && !isOpen) {
      return (
        <li key={item.label}>
          <Tooltip>
            <TooltipTrigger render={
              <Link 
                to={item.path} 
                className={`flex items-center justify-center w-10 h-10 rounded-md transition-all group ${
                  isActive 
                    ? 'bg-gold/10 text-gold' 
                    : 'text-ink/70 hover:text-gold hover:bg-gold/5'
                }`}
              >
                <item.icon className={`w-5 h-5 shrink-0 ${isActive ? 'text-gold' : 'opacity-70 group-hover:opacity-100'}`} />
              </Link>
            } />
            <TooltipContent side="right">
              {item.label}
            </TooltipContent>
          </Tooltip>
        </li>
      );
    }

    return (
      <li key={item.label} className="w-full">
        <Link 
          to={item.path} 
          onClick={() => onClose?.()}
          className={`flex items-center gap-2 lg:gap-3 px-2 py-2 text-xs lg:text-sm rounded-md transition-all group ${
            isActive 
              ? 'bg-gold/10 text-gold font-bold' 
              : 'text-ink/70 hover:text-gold hover:bg-gold/5'
          }`}
        >
          <item.icon className={`w-4 h-4 lg:w-5 lg:h-5 shrink-0 ${isActive ? 'text-gold' : 'opacity-70 group-hover:opacity-100'}`} />
          <span className="truncate">{item.label}</span>
        </Link>
        {item.subItems && (
          <ul className="mt-1 ml-4 border-l border-gold/10 pl-2 space-y-1">
            {item.subItems.map((subItem: any) => {
              const isSubActive = location.pathname === subItem.path;
              return (
                <li key={subItem.label}>
                  <Link 
                    to={subItem.path} 
                    onClick={() => onClose?.()}
                    className={`flex items-center gap-2 px-2 py-1.5 text-[10px] lg:text-xs rounded-md transition-all ${
                      isSubActive 
                        ? 'bg-gold/10 text-gold font-bold' 
                        : 'text-ink/60 hover:text-gold hover:bg-gold/5'
                    }`}
                  >
                    <span className="truncate">{subItem.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </li>
    );
  };

  const sidebarContent = (
    <div className="flex flex-col h-full min-h-0 bg-card">
      <div className={`p-4 border-b border-gold/10 flex flex-col items-center text-center shrink-0 relative ${isCollapsed && !isOpen ? 'px-2' : ''}`}>
        {/* Removed Desktop Toggle Tab in favor of Navbar menu */}

        {campaign ? (
          <Link 
            to={`/campaign/${campaign.id}`}
            onClick={() => onClose?.()}
            className="group flex flex-col items-center text-center transition-all w-full"
          >
            {campaign.imageUrl ? (
              <div className={`rounded-full overflow-hidden border-2 border-gold/30 mb-3 flex items-center justify-center transition-all group-hover:border-gold/60 shadow-lg shadow-black/20 ${isCollapsed && !isOpen ? 'w-10 h-10 mb-1' : 'w-16 h-16 lg:w-20 lg:h-20 xl:w-24 xl:h-24'}`}>
                <img src={campaign.imageUrl} alt={campaign.name} className="w-full h-full object-cover" />
              </div>
            ) : (
              <div className={`rounded-full bg-gold/10 border-2 border-gold/30 mb-3 flex items-center justify-center transition-all group-hover:border-gold/60 group-hover:bg-gold/20 ${isCollapsed && !isOpen ? 'w-10 h-10 mb-1' : 'w-16 h-16 lg:w-20 lg:h-20 xl:w-24 xl:h-24'}`}>
                <Shield className={`${isCollapsed && !isOpen ? 'w-5 h-5' : 'w-8 h-8 lg:w-10 lg:h-10'} text-gold/50 transition-colors group-hover:text-gold`} />
              </div>
            )}
            
            {(!isCollapsed || isOpen) && (
              <div className="w-full space-y-1">
                <h2 className="font-serif font-bold text-sm lg:text-base xl:text-lg text-ink leading-tight truncate w-full group-hover:text-gold transition-colors">
                  {campaign.name}
                </h2>
                <div className="flex items-center justify-center gap-1.5">
                  <Shield className={`w-3 h-3 ${isStaff ? 'text-gold' : 'text-ink/30'}`} />
                  <span className={`nav-label ${isStaff ? 'text-gold' : 'text-ink/40'}`}>
                    {(userProfile?.role || 'User').replace('-', ' ')}
                  </span>
                </div>
              </div>
            )}
          </Link>
        ) : (
          <div className="flex flex-col items-center text-center w-full">
            <div className={`rounded-full bg-gold/10 border-2 border-gold/30 mb-3 flex items-center justify-center transition-all ${isCollapsed && !isOpen ? 'w-10 h-10 mb-1' : 'w-16 h-16 lg:w-20 lg:h-20 xl:w-24 xl:h-24'}`}>
              <Shield className={`${isCollapsed && !isOpen ? 'w-5 h-5' : 'w-8 h-8 lg:w-10 lg:h-10'} text-gold/50`} />
            </div>
            {(!isCollapsed || isOpen) && (
              <div className="w-full space-y-1">
                <h2 className="font-serif font-bold text-sm lg:text-base xl:text-lg text-ink leading-tight truncate w-full">
                  No Campaign
                </h2>
                <div className="flex items-center justify-center gap-1.5">
                  <Shield className={`w-3 h-3 ${isStaff ? 'text-gold' : 'text-ink/30'}`} />
                  <span className={`nav-label ${isStaff ? 'text-gold' : 'text-ink/40'}`}>
                    {(userProfile?.role || 'User').replace('-', ' ')}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <ScrollArea className="flex-1 min-h-0 overflow-y-auto">
        <div className={`p-2 lg:p-3 space-y-6 ${isCollapsed && !isOpen ? 'px-1' : ''}`}>
          {userProfile && recentArticles.length > 0 && (!isCollapsed || isOpen) && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 nav-label text-gold mb-2 px-2">
                <Bookmark className="w-3 h-3" />
                <span>Recent</span>
              </div>
              <ul className="space-y-1">
                {recentArticles.slice(0, 5).map(article => (
                  <li key={article.id}>
                    <Link 
                      to={`/wiki/article/${article.id}`}
                      onClick={() => onClose?.()}
                      className="block px-2 py-1.5 text-[10px] lg:text-xs text-ink/70 hover:text-gold hover:bg-gold/5 rounded transition-colors truncate"
                    >
                      {article.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(['world', 'time', 'game'] as const).map(sectionKey => (
            <div key={sectionKey} className="space-y-1">
              {(!isCollapsed || isOpen) ? (
                <button 
                  onClick={() => toggleSection(sectionKey)}
                  className="nav-section-btn nav-label text-gold"
                >
                  <span>{sectionKey}</span>
                  {expandedSections[sectionKey] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                </button>
              ) : (
                <div className="h-px bg-gold/10 my-4 mx-2" />
              )}
              
              <AnimatePresence initial={false}>
                {((!isCollapsed || isOpen) ? expandedSections[sectionKey] : true) && (
                  <motion.ul 
                    initial={(!isCollapsed || isOpen) ? { height: 0, opacity: 0 } : { opacity: 1 }}
                    animate={(!isCollapsed || isOpen) ? { height: 'auto', opacity: 1 } : { opacity: 1 }}
                    exit={(!isCollapsed || isOpen) ? { height: 0, opacity: 0 } : { opacity: 1 }}
                    className={`space-y-1 overflow-hidden ${(!isCollapsed || isOpen) ? 'pl-1' : 'flex flex-col items-center'}`}
                  >
                    {navItems[sectionKey].map(item => renderNavItem(item))}
                  </motion.ul>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </ScrollArea>

      {isStaff && (
        <div className={`p-4 border-t border-gold/10 shrink-0 space-y-2 ${isCollapsed && !isOpen ? 'p-2' : ''}`}>
          {/* Image Manager */}
          <Link to="/admin/images" onClick={() => onClose?.()}>
            {(!isCollapsed || isOpen) ? (
              <Button
                size="sm"
                variant="ghost"
                className={`w-full justify-start gap-2 text-xs text-ink/60 hover:text-gold hover:bg-gold/5 ${
                  location.pathname === '/admin/images' ? 'text-gold bg-gold/10' : ''
                }`}
              >
                <ImageIcon className="w-3.5 h-3.5 shrink-0" /> Image Manager
              </Button>
            ) : (
              <Tooltip>
                <TooltipTrigger render={
                  <Button
                    size="icon"
                    variant="ghost"
                    className="w-10 h-10 mx-auto text-ink/60 hover:text-gold hover:bg-gold/5"
                  >
                    <ImageIcon className="w-5 h-5" />
                  </Button>
                } />
                <TooltipContent side="right">Image Manager</TooltipContent>
              </Tooltip>
            )}
          </Link>

          {/* New Entry */}
          <Link to="/wiki/new" onClick={() => onClose?.()} className="block">
            {(!isCollapsed || isOpen) ? (
              <Button size="sm" className="w-full bg-gold hover:bg-gold/90 text-white gap-2 shadow-lg shadow-gold/20 text-xs lg:text-sm">
                <Plus className="w-3 h-3 lg:w-4 lg:h-4" /> New Entry
              </Button>
            ) : (
              <Tooltip>
                <TooltipTrigger render={
                  <Button size="icon" className="w-10 h-10 mx-auto bg-gold hover:bg-gold/90 text-white shadow-lg shadow-gold/20">
                    <Plus className="w-5 h-5" />
                  </Button>
                } />
                <TooltipContent side="right">New Entry</TooltipContent>
              </Tooltip>
            )}
          </Link>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className={`hidden md:flex ${isCollapsed ? 'w-16' : 'w-48 lg:w-56 xl:w-64'} border-r border-gold/20 flex-col h-screen sticky top-0 shrink-0 overflow-hidden min-h-0 transition-all duration-300 z-30`}>
        {sidebarContent}
      </aside>

      {/* Mobile Sidebar Drawer */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
              className="fixed inset-0 bg-black/60 z-[90] md:hidden backdrop-blur-sm"
            />
            {/* Drawer */}
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed inset-y-0 left-0 w-64 bg-card border-r border-gold/20 z-[100] md:hidden shadow-2xl flex flex-col min-h-0"
            >
              <div className="absolute right-2 top-2 z-10">
                <Button variant="ghost" size="sm" onClick={onClose} className="text-gold">
                  <PanelLeftClose className="w-5 h-5" />
                </Button>
              </div>
              {sidebarContent}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
