import React, { useState, useEffect } from 'react';
import { 
  Wine, Beer, Play, Users, Plus, X, ChevronRight, RefreshCcw,
  Sparkles, Flame, MessageCircle, Lock, Unlock, Video, Dices,
  Timer, Home, Gamepad2, User as UserIcon, CreditCard, ShieldCheck,
  Sun, Moon, Monitor, Gavel, Trash2, PlusCircle, Volume2, VolumeX, CheckCircle, Settings, Info
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, signInAnonymously, onAuthStateChanged, 
  GoogleAuthProvider, signInWithPopup, signOut, sendSignInLinkToEmail, 
  isSignInWithEmailLink, signInWithEmailLink 
} from 'firebase/auth';
import type { User } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';

// --- Types & Interfaces ---
interface Card {
  type: string;
  text: string;
  severity?: number;
  requiresCustomInput?: boolean;
  isOngoing?: boolean;
  canCancel?: boolean;
  expiresNextTurn?: boolean;
  untilReplaced?: boolean;
  clearsAllRules?: boolean;
  opensRuleManager?: boolean;
  baseText?: string;
}

interface Deck {
  id: string;
  name: string;
  icon: React.ReactNode;
  color: string;
  description: string;
  isPremium?: boolean;
  cards: Card[];
}

interface ActiveRule extends Card {
  owner: string;
}

interface MiniGame {
  id: string;
  name: string;
  icon: React.ReactNode;
  color: string;
  description: string;
  isPremium: boolean;
}

// --- Firebase Setup ---
// TODO: Replace these with your actual Firebase Config from the Firebase Console
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "YOUR_API_KEY",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "YOUR_AUTH_DOMAIN",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "YOUR_PROJECT_ID",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "YOUR_STORAGE_BUCKET",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "YOUR_SENDER_ID",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "YOUR_APP_ID"
};

const app = firebaseConfig.apiKey !== "YOUR_API_KEY" ? initializeApp(firebaseConfig) : null;
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;

// --- Sound Engine ---
const SoundEngine = {
  ctx: null as AudioContext | null,
  muted: false,
  init() {
    if (this.muted) return;
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioContextClass();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  },
  playTone(freq: number, type: OscillatorType, duration: number, vol: number, endFreq: number | null = null) {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
    if (endFreq) {
      osc.frequency.exponentialRampToValueAtTime(endFreq, this.ctx.currentTime + duration);
    }
    
    gain.gain.setValueAtTime(vol, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
    
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    
    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  },
  click() { this.playTone(600, 'sine', 0.1, 0.1); },
  flip() { this.playTone(300, 'triangle', 0.15, 0.15, 100); }, 
  tick() { this.playTone(1200, 'square', 0.05, 0.05); }, 
  success() { 
    this.playTone(400, 'sine', 0.1, 0.1); 
    setTimeout(() => this.playTone(600, 'sine', 0.2, 0.1), 100); 
  },
  alarm() {
    this.playTone(800, 'sawtooth', 0.2, 0.1);
    setTimeout(() => this.playTone(800, 'sawtooth', 0.2, 0.1), 250);
  }
};

// --- Game Data ---
const DECKS: Record<string, Deck> = {
  classic: {
    id: 'classic',
    name: 'Party Starter',
    icon: <Beer size={24} />,
    color: 'from-blue-500 to-cyan-400',
    description: 'Classic rules, dares, and group drinks. Perfect for breaking the ice.',
    cards: [
      { type: 'Group', text: 'Waterfall! {player} starts drinking, then the person to their left, and so on. You cannot stop drinking until the person to your right stops. {player} can stop first.', severity: 3 },
      { type: 'Individual', text: '{player}, take 2 sips for being on your phone too much today.', severity: 1 },
      { type: 'Rule', requiresCustomInput: true, text: '{player} gets to invent a new rule! Anyone who breaks it takes a sip. Type your new rule below to save it.', severity: 2 },
      { type: 'Game', text: 'Categories! {player} names a category (e.g., Fast Food Chains). Go clockwise naming items. First to hesitate or repeat an item takes 2 sips.', severity: 2 },
      { type: 'Duel', isOngoing: true, untilReplaced: true, text: '{player}, pick a partner. They are your new drinking buddy. Whenever you have to drink, they must also drink. Lasts until you get a new buddy.', severity: 2 },
      { type: 'Rule', isOngoing: true, canCancel: true, text: 'No pointing! Anyone caught pointing with their finger takes a sip. Use your elbows! {player} can cancel this rule when it is their turn again.', severity: 2 },
    ]
  },
  neverHaveIEver: {
    id: 'neverHaveIEver',
    name: 'Never Have I Ever',
    icon: <MessageCircle size={24} />,
    color: 'from-orange-500 to-amber-500',
    description: 'Find out your friends\' secrets. If you have done it, drink!',
    cards: [
      { type: 'Confession', text: 'Never have I ever ghosted someone after a first date.', severity: 1 },
      { type: 'Confession', text: 'Never have I ever sent a risky text to the wrong person.', severity: 2 },
      { type: 'Confession', text: 'Never have I ever lied about my age to get into a club.', severity: 1 },
    ]
  },
  spicy: {
    id: 'spicy',
    name: 'Spicy Dares',
    icon: <Flame size={24} />,
    color: 'from-orange-500 to-red-600',
    description: 'Things are about to get weird. Play at your own risk.',
    isPremium: true,
    cards: [
      { type: 'Dare', text: '{player}, let the group send a text to anyone in your contacts, or take 3 sips.', severity: 3 },
      { type: 'Dare', text: '{player}, swap a piece of clothing with the person to your left, or finish your drink.', severity: 3 },
    ]
  }
};

const MINI_GAMES: Record<string, MiniGame> = {
  roulette: {
    id: 'roulette',
    name: 'Wheel of Fate',
    icon: <Dices size={24} />,
    color: 'from-orange-600 to-amber-600',
    description: 'Spin the wheel. Fate decides who drinks and what they do.',
    isPremium: false
  },
  reaction: {
    id: 'reaction',
    name: 'Quick Draw',
    icon: <Timer size={24} />,
    color: 'from-green-500 to-emerald-600',
    description: 'Fastest tapper wins. Slowest player gets a random punishment! (Premium)',
    isPremium: true
  }
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'home' | 'games' | 'profile'>('home'); 
  const [screen, setScreen] = useState<string>('setup'); 
  const [players, setPlayers] = useState<string[]>(['Alex', 'Sam', 'Jordan']);
  const [newPlayer, setNewPlayer] = useState('');
  const [selectedDeck, setSelectedDeck] = useState<Deck | null>(null);
  const [currentCard, setCurrentCard] = useState<Card | null>(null);
  const [currentPlayerIndex, setCurrentPlayerIndex] = useState(0);
  const [activeRules, setActiveRules] = useState<ActiveRule[]>([]);

  const [theme, setTheme] = useState('system'); 
  const [systemDark, setSystemDark] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);

  const [user, setUser] = useState<User | null>(null);
  const [isPremiumPaid, setIsPremiumPaid] = useState(false);
  const [adUnlockedUntil, setAdUnlockedUntil] = useState(0);
  const [adState, setAdState] = useState<{show: boolean; playing: boolean; pendingMode: any; type: string | null}>({ show: false, playing: false, pendingMode: null, type: null });
  
  const [emailInput, setEmailInput] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [authError, setAuthError] = useState('');

  const isPremiumActive = () => isPremiumPaid || Date.now() < adUnlockedUntil;

  // Initialization
  useEffect(() => {
    const savedTheme = localStorage.getItem('app_theme');
    if (savedTheme) setTheme(savedTheme);

    const savedSound = localStorage.getItem('app_sound');
    if (savedSound !== null) {
      const isSoundOn = savedSound === 'true';
      setSoundEnabled(isSoundOn);
      SoundEngine.muted = !isSoundOn;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemDark(mediaQuery.matches);
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  const handleSetTheme = (newTheme: string) => {
    SoundEngine.click();
    setTheme(newTheme);
    localStorage.setItem('app_theme', newTheme);
  };

  const handleToggleSound = () => {
    const newState = !soundEnabled;
    setSoundEnabled(newState);
    SoundEngine.muted = !newState;
    localStorage.setItem('app_sound', newState.toString());
    if (newState) {
      SoundEngine.muted = false;
      SoundEngine.success();
    }
  };

  const isDark = theme === 'dark' || (theme === 'system' && systemDark);

  useEffect(() => {
    if (isDark) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [isDark]);

  useEffect(() => {
    if (!auth) return;
    const initAuth = async () => {
      try {
        if (isSignInWithEmailLink(auth, window.location.href)) {
          let email = window.localStorage.getItem('emailForSignIn');
          if (!email) {
             email = window.prompt('Please provide your email for confirmation');
          }
          if (email) {
            await signInWithEmailLink(auth, email, window.location.href);
            window.localStorage.removeItem('emailForSignIn');
            window.history.replaceState(null, '', window.location.pathname);
            setActiveTab('profile'); 
          }
        } else if (!auth.currentUser) {
          await signInAnonymously(auth);
        }
      } catch (error: any) {
        console.error("Auth error:", error);
        setAuthError(error.message);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !db) return;
    const userRef = doc(db, 'users', user.uid, 'profile', 'settings');
    const unsubscribe = onSnapshot(userRef, (docSnap) => {
      if (docSnap.exists() && docSnap.data().isPremiumPaid) {
        setIsPremiumPaid(true);
      } else {
        setIsPremiumPaid(false);
      }
    }, (err) => console.error("Firestore error:", err));
    return () => unsubscribe();
  }, [user]);

  const purchasePremium = async () => {
    if (!user || !db) return;
    try {
      const userRef = doc(db, 'users', user.uid, 'profile', 'settings');
      await setDoc(userRef, { isPremiumPaid: true }, { merge: true });
    } catch (error) {
      console.error("Error upgrading:", error);
    }
  };

  const handleGoogleSignIn = async () => {
    if (!auth) return;
    setAuthError('');
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Google Sign In Error:", error);
      setAuthError("Failed to sign in with Google.");
    }
  };

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth || !emailInput.trim()) return;
    setAuthError('');
    
    const actionCodeSettings = {
      url: window.location.href, 
      handleCodeInApp: true,
    };

    try {
      await sendSignInLinkToEmail(auth, emailInput, actionCodeSettings);
      window.localStorage.setItem('emailForSignIn', emailInput);
      setEmailSent(true);
    } catch (error) {
      console.error("Email Link Error:", error);
      setAuthError("Failed to send login link. Please try again.");
    }
  };

  const handleSignOut = async () => {
    if (!auth) return;
    try {
      await signOut(auth);
      await signInAnonymously(auth);
      setEmailSent(false);
      setEmailInput('');
    } catch (error) {
      console.error("Sign Out Error:", error);
    }
  };

  const startFromHome = () => {
    SoundEngine.init(); 
    SoundEngine.click();
    setActiveTab('games');
    setScreen('setup');
  };

  const handleAddPlayer = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPlayer.trim() && !players.includes(newPlayer.trim())) {
      SoundEngine.click();
      setPlayers([...players, newPlayer.trim()]);
      setNewPlayer('');
    }
  };

  const handleRemovePlayer = (name: string) => {
    SoundEngine.click();
    setPlayers(players.filter(p => p !== name));
  };

  const handleSelectMode = (mode: Deck | MiniGame, type: 'deck' | 'game') => {
    SoundEngine.click();
    if (mode.isPremium && !isPremiumActive()) {
      setAdState({ show: true, playing: false, pendingMode: mode, type });
      return;
    }
    if (type === 'deck') startGame(mode.id);
    else if (type === 'game') setScreen(mode.id);
  };

  const watchAd = () => {
    setAdState(prev => ({ ...prev, playing: true }));
    setTimeout(() => {
      setAdUnlockedUntil(Date.now() + 10 * 60 * 1000); 
      setAdState(prev => {
        if (prev.pendingMode) {
          setTimeout(() => {
            if (prev.type === 'deck') startGame(prev.pendingMode.id);
            else setScreen(prev.pendingMode.id);
          }, 500);
        }
        return { show: false, playing: false, pendingMode: null, type: null };
      });
    }, 3000);
  };

  const closeAdModal = () => setAdState({ show: false, playing: false, pendingMode: null, type: null });

  const startGame = (deckId: string) => {
    SoundEngine.click();
    setSelectedDeck(DECKS[deckId]);
    setCurrentPlayerIndex(0);
    setActiveRules([]); 
    drawCard(DECKS[deckId], players[0], []);
    setScreen('play');
  };

  const drawCard = (deck: Deck, playerName: string, currentActiveRules: ActiveRule[]) => {
    const activeBaseTexts = currentActiveRules.map(r => r.baseText);
    const availableCards = deck.cards.filter(c => {
      if (c.requiresCustomInput) return true; 
      return !activeBaseTexts.includes(c.text);
    });
    
    let pool = availableCards.length > 0 ? availableCards : deck.cards;

    if (currentCard && pool.length > 1) {
      pool = pool.filter(c => c.text !== currentCard.baseText);
    }
    
    const randomCardIndex = Math.floor(Math.random() * pool.length);
    let card: Card = { ...pool[randomCardIndex] };
    card.baseText = card.text; 
    card.text = card.text.replace(/{player}/g, playerName);
    setCurrentCard(card);

    if (card.clearsAllRules) {
      setActiveRules([]);
    } else if (card.isOngoing) {
      setActiveRules(prev => {
        if (card.untilReplaced) {
          const filtered = prev.filter(r => r.baseText !== card.baseText);
          return [...filtered, { 
            ...card, owner: playerName, 
          } as ActiveRule];
        }
        if (prev.some(r => r.baseText === card.baseText)) return prev;
        return [...prev, { 
          ...card, owner: playerName,
        } as ActiveRule];
      });
    }
  };

  const nextTurn = () => {
    SoundEngine.flip();
    const nextIndex = (currentPlayerIndex + 1) % players.length;
    setCurrentPlayerIndex(nextIndex);
    if(selectedDeck) drawCard(selectedDeck, players[nextIndex], activeRules);
  };

  const goToProfile = () => {
    SoundEngine.click();
    setActiveTab('profile');
  };

  return (
    <div className={`flex justify-center items-center min-h-screen bg-slate-200 dark:bg-neutral-950 transition-colors duration-300 font-sans`}>
      <div className="relative w-full h-screen sm:h-[850px] sm:w-[400px] bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white sm:rounded-[3rem] sm:border-[8px] border-slate-300 dark:border-slate-800 overflow-hidden shadow-2xl shadow-orange-900/10 dark:shadow-orange-900/20 flex flex-col transition-colors duration-300">
        
        <div className="flex-1 overflow-y-auto hide-scrollbar relative flex flex-col w-full">
          {activeTab === 'home' && <HomeScreen startParty={startFromHome} goToProfile={goToProfile} />}
          
          {activeTab === 'games' && (
            <>
              {screen === 'setup' && (
                <SetupScreen 
                  players={players} 
                  newPlayer={newPlayer} 
                  setNewPlayer={setNewPlayer} 
                  handleAddPlayer={handleAddPlayer} 
                  handleRemovePlayer={handleRemovePlayer} 
                  setScreen={setScreen}
                  goToProfile={goToProfile}
                />
              )}
              {screen === 'selectDeck' && (
                <HubScreen 
                  handleSelectMode={handleSelectMode} 
                  setScreen={setScreen} 
                  isPremiumActive={isPremiumActive()}
                  goToProfile={goToProfile}
                />
              )}
              {screen === 'play' && selectedDeck && currentCard && (
                <GameScreen 
                  deck={selectedDeck} 
                  card={currentCard} 
                  player={players[currentPlayerIndex]} 
                  nextPlayer={players[(currentPlayerIndex + 1) % players.length]}
                  nextTurn={nextTurn} 
                  endGame={() => setScreen('selectDeck')} 
                  activeRules={activeRules}
                  setActiveRules={setActiveRules}
                />
              )}
              {screen === 'roulette' && (
                <RouletteScreen players={players} endGame={() => setScreen('selectDeck')} />
              )}
              {screen === 'reaction' && (
                <ReactionScreen players={players} endGame={() => setScreen('selectDeck')} />
              )}
            </>
          )}

          {activeTab === 'profile' && (
            <ProfileScreen 
              user={user} 
              isPremiumPaid={isPremiumPaid} 
              purchasePremium={purchasePremium} 
              onGoogleSignIn={handleGoogleSignIn}
              onEmailSignIn={handleEmailSignIn}
              emailInput={emailInput}
              setEmailInput={setEmailInput}
              emailSent={emailSent}
              authError={authError}
              onSignOut={handleSignOut}
              theme={theme}
              setTheme={handleSetTheme}
              soundEnabled={soundEnabled}
              toggleSound={handleToggleSound}
            />
          )}

          {adState.show && (
            <AdModal 
              playing={adState.playing} 
              watchAd={watchAd} 
              closeModal={closeAdModal} 
              modeName={adState.pendingMode?.name || 'Premium'}
              purchasePremium={purchasePremium}
            />
          )}
        </div>

        {(!['play', 'roulette', 'reaction'].includes(screen) || activeTab !== 'games') && (
          <BottomNav 
            activeTab={activeTab} 
            setActiveTab={(tab) => {
              setActiveTab(tab);
              if (tab === 'games') setScreen('setup');
            }} 
          />
        )}
      </div>
    </div>
  );
}

// --- Components ---

function BottomNav({ activeTab, setActiveTab }: { activeTab: string, setActiveTab: (tab: 'home' | 'games' | 'profile') => void }) {
  const handleTabClick = (tab: 'home' | 'games' | 'profile') => {
    SoundEngine.click();
    setActiveTab(tab);
  };

  return (
    <nav className="w-full shrink-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 pb-safe sm:pb-4 pt-3 px-6 z-40 transition-colors duration-300">
      <div className="flex justify-around items-center">
        <button onClick={() => handleTabClick('home')} className={`flex flex-col items-center gap-1 transition-colors ${activeTab === 'home' ? 'text-orange-500 dark:text-orange-400' : 'text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300'}`}>
          <Home size={24} />
          <span className="text-[10px] font-bold uppercase tracking-wider">Home</span>
        </button>
        <button onClick={() => handleTabClick('games')} className={`flex flex-col items-center gap-1 transition-colors ${activeTab === 'games' ? 'text-orange-500 dark:text-orange-400' : 'text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300'}`}>
          <Gamepad2 size={24} />
          <span className="text-[10px] font-bold uppercase tracking-wider">Play</span>
        </button>
        <button onClick={() => handleTabClick('profile')} className={`flex flex-col items-center gap-1 transition-colors ${activeTab === 'profile' ? 'text-orange-500 dark:text-orange-400' : 'text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300'}`}>
          <UserIcon size={24} />
          <span className="text-[10px] font-bold uppercase tracking-wider">Profile</span>
        </button>
      </div>
    </nav>
  );
}

function ProfileScreen({ user, isPremiumPaid, purchasePremium, onGoogleSignIn, onEmailSignIn, emailInput, setEmailInput, emailSent, authError, onSignOut, theme, setTheme, soundEnabled, toggleSound }: any) {
  const isAnonymous = !user || user.isAnonymous;
  const [showInfo, setShowInfo] = useState(false);

  return (
    <div className="min-h-full pt-safe sm:pt-12 px-6 pb-24 animate-in slide-in-from-right duration-300 w-full flex flex-col">
      <h2 className="text-2xl sm:text-3xl font-bold mb-6 text-slate-900 dark:text-white">Profile</h2>
      
      {isAnonymous ? (
        <div className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-3xl p-6 mb-6 w-full text-center transition-colors shadow-sm">
          {isPremiumPaid && (
            <div className="mb-6 bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-800/50 rounded-2xl p-4 text-left animate-in zoom-in duration-300">
              <h4 className="text-red-700 dark:text-red-400 font-bold flex items-center gap-2 mb-2">
                ⚠️ Account Unlinked
              </h4>
              <p className="text-sm text-red-600 dark:text-red-300">
                You have Lifetime VIP on this Guest account! If you delete the app or clear your browser data, you will lose your purchase. Please link an account below to save it securely.
              </p>
            </div>
          )}

          {!isPremiumPaid && (
            <div className="w-16 h-16 bg-slate-100 dark:bg-slate-700 rounded-full flex items-center justify-center text-slate-400 mx-auto mb-4">
              <UserIcon size={32} />
            </div>
          )}
          
          <h3 className="font-bold text-lg text-slate-900 dark:text-white mb-2">Guest Player</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">Sign in to save your premium purchases and custom games across all your devices.</p>
          
          {authError && (
             <p className="text-red-500 text-sm font-bold mb-4 bg-red-50 dark:bg-red-900/20 py-2 rounded-lg">{authError}</p>
          )}

          {emailSent ? (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/50 rounded-2xl p-6 mb-4">
              <div className="w-12 h-12 bg-green-100 dark:bg-green-900/50 rounded-full flex items-center justify-center mx-auto mb-3 text-green-500">
                <CheckCircle size={24} />
              </div>
              <h4 className="font-bold text-green-700 dark:text-green-400 mb-2">Check your email!</h4>
              <p className="text-sm text-green-600 dark:text-green-300">We sent a magic link to <strong>{emailInput}</strong>. Click it to instantly sign in.</p>
            </div>
          ) : (
            <form onSubmit={onEmailSignIn} className="flex flex-col gap-3 mb-4">
              <input 
                type="email" 
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="Enter your email address..."
                required
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl py-3 px-4 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-orange-500 transition-colors"
              />
              <button 
                type="submit"
                disabled={!emailInput.trim()}
                className="w-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold py-3 rounded-xl shadow-md active:scale-[0.98] transition-all disabled:opacity-50"
              >
                Send Magic Link
              </button>
            </form>
          )}

          <div className="flex items-center gap-4 my-6 opacity-50">
            <div className="h-[1px] flex-1 bg-slate-300 dark:bg-slate-600"></div>
            <span className="text-xs font-bold uppercase tracking-widest text-slate-500">OR</span>
            <div className="h-[1px] flex-1 bg-slate-300 dark:bg-slate-600"></div>
          </div>

          <button 
            onClick={onGoogleSignIn}
            className="w-full bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-white font-bold text-lg py-3 rounded-xl shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 active:scale-[0.98] transition-all flex justify-center items-center gap-3"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Continue with Google
          </button>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-3xl p-6 mb-6 w-full relative transition-colors shadow-sm">
          <button 
            onClick={onSignOut}
            className="absolute top-4 right-4 text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-full transition-colors"
          >
            Sign Out
          </button>
          <div className="flex items-center gap-4 mb-2">
            {user.photoURL ? (
              <img src={user.photoURL} alt="Profile" className="w-16 h-16 rounded-full border-2 border-orange-500" />
            ) : (
              <div className="w-16 h-16 bg-slate-100 dark:bg-slate-700 rounded-full flex items-center justify-center text-slate-400">
                <UserIcon size={32} />
              </div>
            )}
            <div>
              <h3 className="font-bold text-lg text-slate-900 dark:text-white">{user.displayName || 'Player'}</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate max-w-[200px]">
                {user.email || `ID: ${user.uid.substring(0, 8)}`}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-3xl p-6 mb-6 w-full transition-colors shadow-sm">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-lg text-slate-900 dark:text-white">Settings</h3>
          <button 
            onClick={toggleSound}
            className={`p-2 rounded-full transition-colors ${soundEnabled ? 'bg-orange-100 text-orange-500 dark:bg-orange-500/20 dark:text-orange-400' : 'bg-slate-100 text-slate-400 dark:bg-slate-800'}`}
          >
            {soundEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
          </button>
        </div>
        <div className="flex bg-slate-100 dark:bg-slate-900 rounded-xl p-1">
          <button onClick={() => setTheme('system')} className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-bold rounded-lg transition-all ${theme === 'system' ? 'bg-white dark:bg-slate-700 shadow-sm text-orange-500 dark:text-orange-400' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}>
            <Monitor size={16} /> System
          </button>
          <button onClick={() => setTheme('light')} className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-bold rounded-lg transition-all ${theme === 'light' ? 'bg-white dark:bg-slate-700 shadow-sm text-orange-500 dark:text-orange-400' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}>
            <Sun size={16} /> Light
          </button>
          <button onClick={() => setTheme('dark')} className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-bold rounded-lg transition-all ${theme === 'dark' ? 'bg-white dark:bg-slate-700 shadow-sm text-orange-500 dark:text-orange-400' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}>
            <Moon size={16} /> Dark
          </button>
        </div>
      </div>

      <div className="bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-900 border border-slate-300 dark:border-slate-700 rounded-3xl p-6 relative overflow-hidden w-full transition-colors">
        <button 
          onClick={() => { SoundEngine.click(); setShowInfo(true); }} 
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center bg-white/50 dark:bg-slate-900/50 backdrop-blur-md text-slate-400 hover:text-orange-500 rounded-full transition-colors z-10 shadow-sm"
        >
          <Info size={16} />
        </button>

        {isPremiumPaid ? (
          <div className="flex flex-col items-center text-center mt-2">
            <div className="w-16 h-16 bg-gradient-to-br from-orange-500 to-amber-500 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-orange-900/40">
              <ShieldCheck size={32} className="text-white" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Lifetime VIP Active</h3>
            <p className="text-slate-600 dark:text-slate-400 text-sm">You have fully unlocked all premium decks, mini-games, and removed ads permanently.</p>
          </div>
        ) : (
          <div className="flex flex-col mt-2">
            <div className="flex items-center gap-3 mb-4 text-orange-500 dark:text-orange-400">
              <Lock size={20} />
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">Lifetime VIP</h3>
            </div>
            <p className="text-slate-600 dark:text-slate-400 text-sm mb-6">Unlock all premium decks, mini-games, and remove ads forever with a one-time purchase.</p>
            
            <button 
              onClick={purchasePremium}
              className="w-full bg-gradient-to-r from-orange-500 to-amber-500 dark:from-orange-600 dark:to-amber-600 text-white font-bold text-lg py-4 rounded-xl shadow-lg shadow-orange-900/20 dark:shadow-orange-900/30 active:scale-[0.98] transition-all flex justify-center items-center gap-2"
            >
              <CreditCard size={20} /> Get VIP for R299
            </button>
          </div>
        )}
      </div>

      {showInfo && <PremiumInfoModal closeModal={() => setShowInfo(false)} />}
    </div>
  );
}

function HomeScreen({ startParty, goToProfile }: {startParty: () => void, goToProfile: () => void}) {
  return (
    <div className="h-full flex flex-col items-center justify-center p-6 relative w-full">
      <button 
        onClick={goToProfile}
        className="absolute top-safe sm:top-6 right-6 w-10 h-10 bg-white/50 dark:bg-slate-800/50 backdrop-blur-md border border-slate-200 dark:border-slate-700 rounded-full flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-orange-500 z-20 shadow-sm"
      >
        <Settings size={20} />
      </button>

      <div className="absolute top-20 left-10 w-32 h-32 bg-orange-400/30 dark:bg-orange-600/30 rounded-full blur-[50px]"></div>
      <div className="absolute bottom-40 right-10 w-40 h-40 bg-amber-400/30 dark:bg-amber-600/30 rounded-full blur-[60px]"></div>
      
      <div className="relative z-10 flex flex-col items-center text-center w-full">
        <div className="w-24 h-24 bg-gradient-to-tr from-orange-400 to-amber-400 dark:from-orange-500 dark:to-amber-500 rounded-3xl flex items-center justify-center mb-6 shadow-lg shadow-orange-500/20 dark:shadow-orange-500/30 transform rotate-12">
          <Wine size={48} className="text-white transform -rotate-12" />
        </div>
        
        <h1 className="text-4xl sm:text-5xl font-black mb-2 tracking-tight text-slate-900 dark:text-white">Drunk<span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-500 to-amber-500 dark:from-orange-400 dark:to-amber-500">Dilemma</span></h1>
        <p className="text-slate-500 dark:text-slate-400 mb-12 text-lg">The ultimate party companion.</p>
        
        <button 
          onClick={startParty}
          className="w-full max-w-[250px] bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold text-xl py-4 rounded-full shadow-[0_0_20px_rgba(0,0,0,0.1)] dark:shadow-[0_0_20px_rgba(255,255,255,0.3)] hover:scale-105 active:scale-95 transition-all flex items-center justify-center gap-2"
        >
          <Play fill="currentColor" size={20} />
          Start Party
        </button>
      </div>
    </div>
  );
}

function SetupScreen({ players, newPlayer, setNewPlayer, handleAddPlayer, handleRemovePlayer, setScreen, goToProfile }: any) {
  return (
    <div className="min-h-full pt-safe sm:pt-12 px-6 pb-24 flex flex-col animate-in fade-in duration-300 w-full relative">
      <button 
        onClick={goToProfile}
        className="absolute top-safe sm:top-8 right-6 w-10 h-10 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-orange-500 transition-colors shadow-sm z-20"
      >
        <Settings size={20} />
      </button>

      <h2 className="text-2xl sm:text-3xl font-bold mb-2 text-slate-900 dark:text-white pr-12">Who's Drinking?</h2>
      <p className="text-slate-500 dark:text-slate-400 mb-8">Add your crew to personalize the prompts.</p>
      
      <form onSubmit={handleAddPlayer} className="relative mb-8 w-full">
        <input 
          type="text" 
          value={newPlayer}
          onChange={(e) => setNewPlayer(e.target.value)}
          placeholder="Enter player name..." 
          className="w-full bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-2xl py-4 pl-5 pr-14 text-lg text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-orange-500 transition-colors shadow-sm"
        />
        <button 
          type="submit"
          disabled={!newPlayer.trim()}
          className="absolute right-2 top-2 bottom-2 bg-orange-500 dark:bg-orange-600 text-white w-12 rounded-xl flex items-center justify-center disabled:opacity-50 disabled:bg-slate-300 dark:disabled:bg-slate-700 transition-colors"
        >
          <Plus size={24} />
        </button>
      </form>

      <div className="flex-1 w-full flex flex-col">
        <div className="flex items-center gap-2 mb-4">
          <Users size={18} className="text-orange-500 dark:text-orange-400" />
          <h3 className="font-semibold text-lg text-slate-900 dark:text-white">Players ({players.length})</h3>
        </div>
        
        <div className="flex flex-wrap gap-3 mb-6">
          {players.map((player: string) => (
            <div key={player} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 pl-4 pr-2 py-2 rounded-full flex items-center gap-2 shadow-sm animate-in zoom-in-95 duration-200">
              <span className="font-medium text-slate-900 dark:text-white">{player}</span>
              <button 
                onClick={() => handleRemovePlayer(player)}
                className="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 flex items-center justify-center hover:bg-red-100 hover:text-red-500 dark:hover:bg-red-500/20 dark:hover:text-red-400 transition-colors"
              >
                <X size={14} />
              </button>
            </div>
          ))}
          {players.length === 0 && (
            <p className="text-slate-400 dark:text-slate-500 italic text-sm w-full text-center py-4">No players added yet. It's sad drinking alone!</p>
          )}
        </div>
      </div>

      <div className="mt-auto pt-6 w-full z-10">
        <button 
          onClick={() => { SoundEngine.click(); setScreen('selectDeck'); }}
          disabled={players.length < 2}
          className="w-full bg-gradient-to-r from-orange-500 to-amber-500 dark:from-orange-600 dark:to-amber-600 text-white font-bold text-lg py-4 rounded-2xl shadow-lg shadow-orange-900/20 dark:shadow-orange-900/30 disabled:opacity-50 disabled:from-slate-300 disabled:to-slate-400 dark:disabled:from-slate-700 dark:disabled:to-slate-800 transition-all active:scale-[0.98] flex justify-center items-center gap-2"
        >
          Next Step <ChevronRight size={20} />
        </button>
        {players.length < 2 && (
          <p className="text-center text-xs text-slate-500 mt-2">Need at least 2 players to start</p>
        )}
      </div>
    </div>
  );
}

function HubScreen({ handleSelectMode, setScreen, isPremiumActive, goToProfile }: any) {
  const [showInfo, setShowInfo] = useState(false);

  const renderItem = (item: any, type: string) => {
    const locked = item.isPremium && !isPremiumActive;
    
    return (
      <div 
        key={item.id}
        onClick={() => handleSelectMode(item, type)}
        className={`relative overflow-hidden p-6 rounded-3xl cursor-pointer group transition-transform active:scale-[0.98] border ${locked ? 'bg-slate-100/50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800/80' : 'bg-white dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 hover:border-orange-400 dark:hover:border-orange-500'} shadow-sm dark:shadow-none`}
      >
        <div className={`absolute inset-0 bg-gradient-to-br ${item.color} opacity-10 dark:opacity-20 group-hover:opacity-20 dark:group-hover:opacity-30 transition-opacity ${locked ? 'grayscale opacity-5 dark:opacity-10' : ''}`}></div>
        
        <div className="relative z-10 flex items-start gap-4">
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center bg-gradient-to-br ${item.color} shadow-lg text-white shrink-0 relative ${locked ? 'grayscale' : ''}`}>
            {item.icon}
            {locked && (
              <div className="absolute -bottom-2 -right-2 bg-white dark:bg-slate-800 rounded-full p-1 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-300 shadow-md">
                <Lock size={12} />
              </div>
            )}
          </div>
          <div className="flex-1">
            <div className="flex justify-between items-start">
            <h3 className={`text-xl font-bold mb-1 ${locked ? 'text-slate-500 dark:text-slate-400' : 'text-slate-900 dark:text-white'}`}>{item.name}</h3>
            {item.isPremium && isPremiumActive && (
               <Unlock size={16} className="text-orange-500 dark:text-orange-400 mt-1" />
            )}
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{item.description}</p>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-full pt-safe sm:pt-12 px-6 pb-24 animate-in slide-in-from-right duration-300 w-full flex flex-col relative">
      <div className="flex items-center gap-3 mb-8 w-full">
        <button onClick={() => { SoundEngine.click(); setScreen('setup'); }} className="w-10 h-10 shrink-0 bg-white dark:bg-slate-800 border border-slate-200 dark:border-transparent rounded-full flex items-center justify-center text-slate-700 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-700 transition shadow-sm">
          <ChevronRight size={20} className="rotate-180" />
        </button>
        
        <h2 className="text-2xl sm:text-3xl font-bold truncate text-slate-900 dark:text-white mr-auto">
          Game Hub
        </h2>
        
        <div className="flex items-center gap-2 shrink-0">
          <button 
            onClick={() => { SoundEngine.click(); setShowInfo(true); }}
            className="w-10 h-10 shrink-0 bg-white/50 dark:bg-slate-800/50 backdrop-blur-md border border-slate-200 dark:border-slate-700 rounded-full flex items-center justify-center text-orange-500 hover:text-orange-600 transition-colors shadow-sm"
          >
            <Info size={18} />
          </button>
          
          <button 
            onClick={goToProfile}
            className="w-10 h-10 shrink-0 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-orange-500 transition-colors shadow-sm z-20"
          >
            <Settings size={20} />
          </button>
        </div>
      </div>

      <div className="space-y-8 w-full">
        <section>
          <h3 className="text-lg font-bold text-orange-500 dark:text-orange-400 mb-4 flex items-center gap-2">
            <Wine size={18} /> Card Decks
          </h3>
          <div className="flex flex-col gap-4">
            {Object.values(DECKS).map(deck => renderItem(deck, 'deck'))}
          </div>
        </section>

        <section>
          <h3 className="text-lg font-bold text-cyan-500 dark:text-cyan-400 mb-4 flex items-center gap-2">
            <Dices size={18} /> Mini Games
          </h3>
          <div className="flex flex-col gap-4">
            {Object.values(MINI_GAMES).map(game => renderItem(game, 'game'))}
          </div>
        </section>
      </div>

      {showInfo && <PremiumInfoModal closeModal={() => setShowInfo(false)} />}
    </div>
  );
}

function PremiumInfoModal({ closeModal }: { closeModal: () => void }) {
  return (
    <div className="absolute inset-0 z-[100] bg-slate-900/60 dark:bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-3xl p-6 w-full max-w-sm shadow-2xl relative text-left">
        <button onClick={() => { SoundEngine.click(); closeModal(); }} className="absolute top-4 right-4 w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition">
          <X size={16} />
        </button>
        
        <h3 className="text-2xl font-black text-slate-900 dark:text-white mb-6 pr-8">Premium Tiers</h3>
        
        <div className="space-y-5 mb-6">
          <div className="flex gap-4 items-start">
            <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-500 flex items-center justify-center shrink-0 mt-1">
              <Video size={20} />
            </div>
            <div>
              <h4 className="font-bold text-slate-900 dark:text-white">Watch & Play</h4>
              <p className="text-sm text-slate-600 dark:text-slate-400 leading-snug mt-1">Watch a quick sponsor ad to unlock all premium decks and games for 10 minutes. Repeatable anytime.</p>
            </div>
          </div>

          <div className="flex gap-4 items-start">
            <div className="w-10 h-10 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-500 flex items-center justify-center shrink-0 mt-1">
              <RefreshCcw size={20} />
            </div>
            <div>
              <h4 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                Monthly Sub 
                <span className="text-[9px] font-black bg-purple-100 text-purple-600 dark:bg-purple-900/50 dark:text-purple-400 px-2 py-0.5 rounded-full uppercase tracking-widest">Soon</span>
              </h4>
              <p className="text-sm text-slate-600 dark:text-slate-400 leading-snug mt-1">Pay a small monthly fee of R20 for uninterrupted, ad-free play. Cancel anytime you want.</p>
            </div>
          </div>

          <div className="flex gap-4 items-start">
            <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-500 flex items-center justify-center shrink-0 mt-1">
              <ShieldCheck size={20} />
            </div>
            <div>
              <h4 className="font-bold text-slate-900 dark:text-white">Lifetime VIP</h4>
              <p className="text-sm text-slate-600 dark:text-slate-400 leading-snug mt-1">Pay once (R299), own it forever. Ad-free with permanent access to all current and future content.</p>
            </div>
          </div>
        </div>
        
        <button onClick={() => { SoundEngine.click(); closeModal(); }} className="w-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold py-3.5 rounded-xl active:scale-95 transition-transform">
          Got it
        </button>
      </div>
    </div>
  );
}

function AdModal({ playing, watchAd, closeModal, modeName, purchasePremium }: any) {
  return (
    <div className="absolute inset-0 z-50 bg-slate-900/60 dark:bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-3xl p-8 w-full max-w-sm text-center shadow-2xl shadow-orange-900/10 dark:shadow-orange-900/20 m-4">
        {playing ? (
          <div className="flex flex-col items-center py-8">
            <Video size={48} className="text-orange-500 animate-pulse mb-4" />
            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Playing Sponsor Message...</h3>
            <p className="text-slate-500 dark:text-slate-400">Unlocking premium content for 10 minutes.</p>
            <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full mt-6 overflow-hidden">
              <div className="h-full bg-orange-500 animate-[progress_3s_linear_forwards]"></div>
            </div>
          </div>
        ) : (
          <>
            <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-2xl flex items-center justify-center mx-auto mb-4 text-orange-500 dark:text-orange-400 shadow-inner">
              <Lock size={32} />
            </div>
            <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Premium Mode</h3>
            <p className="text-slate-500 dark:text-slate-400 mb-6 text-sm">
              Watch a quick 30-second ad to unlock <strong className="text-slate-900 dark:text-white">{modeName}</strong> and all other premium features for the next 10 minutes!
            </p>
            
            <button 
              onClick={watchAd}
              className="w-full bg-gradient-to-r from-orange-500 to-amber-500 dark:from-orange-600 dark:to-amber-600 text-white font-bold text-lg py-4 rounded-xl shadow-lg shadow-orange-900/20 dark:shadow-orange-900/30 active:scale-[0.98] transition-all flex justify-center items-center gap-2 mb-3"
            >
              <Video size={20} /> Watch Ad to Unlock
            </button>

            <button 
              onClick={purchasePremium}
              className="w-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-lg py-3 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-all flex justify-center items-center gap-2 mb-3"
            >
              <CreditCard size={18} /> Get VIP for R299
            </button>

            <button 
              onClick={closeModal}
              className="w-full py-2 text-slate-500 font-medium hover:text-slate-800 dark:hover:text-slate-300 transition-colors text-sm"
            >
              Maybe Later
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function RouletteScreen({ players, endGame }: any) {
  const [spinning, setSpinning] = useState(false);
  const [displayPlayer, setDisplayPlayer] = useState('?');
  const [displayAction, setDisplayAction] = useState('Spin the wheel to find out');

  const actions = [
    'Takes 2 sips', 'Gives 2 sips', 'Finishes their drink', 
    'Does a shot', 'Picks a drinking buddy', 'Truth or Drink', 
    'Dare or Drink', 'Takes 1 sip', 'Gives 1 sip'
  ];

  const spin = () => {
    if (spinning) return;
    setSpinning(true);
    SoundEngine.click();
    
    const finalPlayer = players[Math.floor(Math.random() * players.length)];
    const finalAction = actions[Math.floor(Math.random() * actions.length)];

    let spins = 0;
    const maxSpins = 25; 
    let currentDelay = 50;
    
    const executeSpinStep = () => {
      setDisplayPlayer(players[Math.floor(Math.random() * players.length)]);
      setDisplayAction(actions[Math.floor(Math.random() * actions.length)]);
      SoundEngine.tick();
      spins++;
      
      if (spins < maxSpins) {
        if (spins > maxSpins - 10) currentDelay += 30;
        setTimeout(executeSpinStep, currentDelay);
      } else {
        setDisplayPlayer(finalPlayer);
        setDisplayAction(finalAction);
        setSpinning(false);
        setTimeout(() => SoundEngine.success(), 200);
      }
    };
    
    executeSpinStep();
  };

  return (
    <div className="h-full flex flex-col bg-slate-50 dark:bg-slate-950 animate-in fade-in duration-300 w-full transition-colors">
      <div className="pt-safe sm:pt-8 px-6 pb-4 flex justify-between items-center bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 w-full transition-colors">
        <div className="flex items-center gap-2 text-amber-500 dark:text-amber-400">
          <Dices size={20} />
          <span className="font-bold text-sm tracking-widest uppercase">Wheel of Fate</span>
        </div>
        <button onClick={() => { SoundEngine.click(); endGame(); }} className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition shadow-sm">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-6 relative w-full">
        <div className={`w-full max-w-sm aspect-square rounded-[3rem] border-4 flex flex-col items-center justify-center p-8 text-center transition-all duration-300 ${spinning ? 'border-orange-500 shadow-[0_0_40px_rgba(249,115,22,0.2)] dark:shadow-[0_0_40px_rgba(249,115,22,0.3)] scale-[0.98] bg-white dark:bg-slate-900' : 'border-amber-400 dark:border-amber-600 bg-white dark:bg-slate-900 shadow-xl shadow-amber-900/10 dark:shadow-amber-900/20'}`}>
          <div className="flex-1 flex flex-col items-center justify-center w-full">
             <h2 className={`text-4xl sm:text-5xl font-black mb-4 truncate w-full transition-colors ${spinning ? 'text-slate-400 dark:text-slate-500 animate-pulse' : 'text-orange-500 dark:text-orange-400'}`}>
               {displayPlayer}
             </h2>
             <p className={`text-xl sm:text-2xl font-bold leading-tight transition-colors ${spinning ? 'text-slate-400 dark:text-slate-600' : 'text-slate-800 dark:text-white'}`}>
               {displayAction}
             </p>
          </div>
        </div>

        <button 
          onClick={spin}
          disabled={spinning}
          className="mt-12 w-full max-w-[250px] bg-amber-500 dark:bg-amber-600 text-white font-bold text-xl py-4 rounded-full shadow-lg shadow-amber-900/20 dark:shadow-amber-900/40 active:scale-95 transition-all disabled:opacity-50 disabled:scale-100 flex items-center justify-center gap-2"
        >
          {spinning ? <RefreshCcw size={20} className="animate-spin" /> : <Dices size={20} />}
          {spinning ? 'Spinning...' : 'Spin Wheel'}
        </button>
      </div>
    </div>
  );
}

function ReactionScreen({ players, endGame }: any) {
  const [gameState, setGameState] = useState('waiting'); // waiting, red, green, finished
  const [currentPlayerIdx, setCurrentPlayerIdx] = useState(0);
  const [results, setResults] = useState<{player: string, time: number}[]>([]);
  const [startTime, setStartTime] = useState(0);
  const [timeoutId, setTimeoutId] = useState<any>(null);
  const [punishment, setPunishment] = useState('');

  const randomPunishments = [
    "Takes 3 penalty sips", 
    "Finishes their entire drink", 
    "Takes 2 penalty sips", 
    "Gives out 3 sips to the winner", 
    "Does a shot", 
    "No phones for 10 mins or 3 sips", 
    "Takes 4 penalty sips", 
    "Picks a new drinking buddy", 
    "Takes 1 penalty sip", 
    "Must take a sip without using hands",
    "Gives out 2 sips"
  ];

  const startRound = () => {
    SoundEngine.click();
    setGameState('red');
    const delay = Math.floor(Math.random() * 3000) + 1500; 
    
    const id = setTimeout(() => {
      setGameState('green');
      setStartTime(Date.now());
      SoundEngine.alarm(); 
    }, delay);
    setTimeoutId(id);
  };

  const handleTap = () => {
    if (gameState === 'red') {
      clearTimeout(timeoutId);
      SoundEngine.tick();
      recordResult(9999);
    } else if (gameState === 'green') {
      SoundEngine.success();
      recordResult(Date.now() - startTime);
    }
  };

  const recordResult = (time: number) => {
    const newResults = [...results, { player: players[currentPlayerIdx], time }];
    setResults(newResults);
    
    if (currentPlayerIdx + 1 < players.length) {
      setCurrentPlayerIdx(currentPlayerIdx + 1);
      setGameState('waiting');
    } else {
      setPunishment(randomPunishments[Math.floor(Math.random() * randomPunishments.length)]);
      setGameState('finished');
    }
  };

  if (gameState === 'finished') {
    const sortedResults = [...results].sort((a, b) => a.time - b.time);
    const loser = sortedResults[sortedResults.length - 1];

    return (
      <div className="h-full flex flex-col bg-slate-50 dark:bg-slate-950 animate-in fade-in duration-300 w-full transition-colors relative">
        <div className="pt-safe sm:pt-8 px-6 pb-4 flex justify-between items-center bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 w-full transition-colors">
          <div className="flex items-center gap-2 text-emerald-500 dark:text-emerald-400">
            <Timer size={20} />
            <span className="font-bold text-sm tracking-widest uppercase">Quick Draw</span>
          </div>
          <button onClick={() => { SoundEngine.click(); endGame(); }} className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition shadow-sm">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 flex flex-col p-6 overflow-y-auto">
          <h2 className="text-3xl font-black text-slate-900 dark:text-white mb-6 text-center">Results</h2>
          
          <div className="flex flex-col gap-3 mb-8">
            {sortedResults.map((res, idx) => (
              <div key={idx} className={`p-4 rounded-2xl flex justify-between items-center ${idx === 0 ? 'bg-emerald-100 dark:bg-emerald-900/40 border-2 border-emerald-500' : idx === sortedResults.length - 1 ? 'bg-red-100 dark:bg-red-900/40 border border-red-200 dark:border-red-800' : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700'}`}>
                <div className="flex items-center gap-3">
                  <span className={`font-bold w-6 ${idx === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>#{idx + 1}</span>
                  <span className="font-bold text-slate-900 dark:text-white">{res.player}</span>
                </div>
                <span className="font-mono font-medium text-slate-600 dark:text-slate-300">
                  {res.time === 9999 ? 'False Start' : `${res.time}ms`}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-auto bg-red-50 dark:bg-red-900/20 border-2 border-red-200 dark:border-red-800/50 rounded-3xl p-6 text-center">
            <Flame size={32} className="mx-auto text-red-500 mb-2" />
            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-1">{loser.player} lost!</h3>
            <p className="text-red-600 dark:text-red-400 font-bold uppercase tracking-wide">{punishment}</p>
          </div>

          <button onClick={() => { SoundEngine.click(); endGame(); }} className="w-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold py-4 rounded-xl active:scale-95 transition-transform mt-6">
            Finish
          </button>
        </div>
      </div>
    );
  }

  return (
    <div 
      className={`h-full flex flex-col animate-in fade-in duration-300 w-full transition-colors relative ${gameState === 'red' ? 'bg-red-500 dark:bg-red-600' : gameState === 'green' ? 'bg-emerald-500 dark:bg-emerald-600' : 'bg-slate-50 dark:bg-slate-950'}`}
      onPointerDown={handleTap}
    >
      <div className={`pt-safe sm:pt-8 px-6 pb-4 flex justify-between items-center w-full transition-colors z-10 ${gameState !== 'waiting' ? 'opacity-0 pointer-events-none' : 'bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800'}`}>
        <div className="flex items-center gap-2 text-emerald-500 dark:text-emerald-400">
          <Timer size={20} />
          <span className="font-bold text-sm tracking-widest uppercase">Quick Draw</span>
        </div>
        <button onClick={(e) => { e.stopPropagation(); SoundEngine.click(); endGame(); }} className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition shadow-sm">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center select-none touch-none">
        {gameState === 'waiting' && (
          <div className="flex flex-col items-center animate-in zoom-in-95">
            <p className="text-slate-500 dark:text-slate-400 mb-2 font-medium uppercase tracking-widest">Pass the phone to</p>
            <h2 className="text-5xl font-black text-slate-900 dark:text-white mb-12">{players[currentPlayerIdx]}</h2>
            
            <button 
              onClick={(e) => { e.stopPropagation(); startRound(); }} 
              className="bg-emerald-500 dark:bg-emerald-600 text-white font-bold text-2xl py-6 px-12 rounded-[2rem] shadow-xl shadow-emerald-900/20 active:scale-95 transition-all"
            >
              I'm Ready
            </button>
            <p className="text-slate-400 dark:text-slate-500 mt-6 text-sm">Tap the screen when it turns green.</p>
          </div>
        )}

        {gameState === 'red' && (
          <div className="text-white">
             <h2 className="text-6xl font-black mb-4">WAIT</h2>
             <p className="text-red-100 font-bold opacity-80">Do not tap yet...</p>
          </div>
        )}

        {gameState === 'green' && (
          <div className="text-white">
             <h2 className="text-6xl font-black mb-4">TAP NOW!</h2>
          </div>
        )}
      </div>
    </div>
  );
}

function GameScreen({ deck, card, player, nextPlayer, nextTurn, endGame, activeRules, setActiveRules }: any) {
  const [animKey, setAnimKey] = useState(0);
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [showTurnReviewModal, setShowTurnReviewModal] = useState(false);
  const [newRuleText, setNewRuleText] = useState('');
  const [customRuleInput, setCustomRuleInput] = useState('');
  const [customRuleSaved, setCustomRuleSaved] = useState(false);
  const [nhieAction, setNhieAction] = useState<string | null>(null);

  useEffect(() => {
    setAnimKey(prev => prev + 1);
    setCustomRuleInput('');
    setCustomRuleSaved(false);
    setNhieAction(null);
    
    if (card?.opensRuleManager && activeRules.length > 0) {
      setTimeout(() => setShowRulesModal(true), 1500); 
    }
  }, [card]);

  const renderSeverity = (level: number) => {
    return (
      <div className="flex gap-1">
        {[1, 2, 3].map(i => (
          <div key={i} className={`w-2 h-2 rounded-full ${i <= level ? 'bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.6)] dark:shadow-[0_0_8px_rgba(249,115,22,0.8)]' : 'bg-slate-200 dark:bg-slate-800'}`}></div>
        ))}
      </div>
    );
  };

  const handleAddCurrentCardAsRule = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!activeRules.some((r: ActiveRule) => r.baseText === card.baseText)) {
      SoundEngine.success();
      setActiveRules([...activeRules, { ...card, owner: player, canCancel: true }]);
    }
  };

  const removeRule = (ruleToRemove: ActiveRule) => {
    SoundEngine.click();
    setActiveRules(activeRules.filter((r: ActiveRule) => r.baseText !== ruleToRemove.baseText));
  };

  const addCustomRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (newRuleText.trim() && !activeRules.some((r: ActiveRule) => r.text === newRuleText.trim())) {
      SoundEngine.success();
      setActiveRules([...activeRules, { type: 'Custom', baseText: `custom_${Date.now()}`, text: newRuleText.trim(), owner: player, canCancel: true }]);
      setNewRuleText('');
    }
  };

  const nextPlayerExpiring = activeRules.filter((r: ActiveRule) => r.owner === nextPlayer && r.expiresNextTurn);
  const nextPlayerCancellable = activeRules.filter((r: ActiveRule) => r.owner === nextPlayer && r.canCancel);

  const handleNextTurnClick = () => {
    if (nextPlayerExpiring.length > 0 || nextPlayerCancellable.length > 0) {
      SoundEngine.click();
      setShowTurnReviewModal(true);
    } else {
      nextTurn();
    }
  };

  return (
    <div className="h-full flex flex-col bg-slate-50 dark:bg-slate-950 animate-in fade-in duration-300 w-full transition-colors relative">
      <div className="pt-safe sm:pt-8 px-6 pb-4 flex justify-between items-center bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 w-full transition-colors relative z-10">
        <div className="flex items-center gap-2 text-orange-500 dark:text-orange-400">
          {deck.icon}
          <span className="font-bold text-sm tracking-widest uppercase">{deck.name}</span>
        </div>
        <div className="flex items-center gap-2">
          {activeRules.length > 0 && (
            <button 
              onClick={() => { SoundEngine.click(); setShowRulesModal(true); }} 
              className="relative h-8 px-3 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-orange-500 dark:hover:text-orange-400 transition-colors shadow-sm"
            >
              <Gavel size={14} className="mr-1.5" />
              <span className="text-xs font-bold uppercase tracking-wider">Rules</span>
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-orange-500 rounded-full text-[10px] text-white flex items-center justify-center font-bold animate-in zoom-in">
                {activeRules.length}
              </span>
            </button>
          )}
          <button onClick={() => { SoundEngine.click(); endGame(); }} className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition shadow-sm">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-6 relative w-full">
        
        <div className="flex flex-col items-center mb-6">
          <p key={`player-${animKey}`} className="text-orange-500 dark:text-orange-400 text-2xl font-black uppercase tracking-wider animate-in slide-in-from-top-2">
            {player}'s Turn
          </p>
          <p key={`next-${animKey}`} className="text-slate-500 dark:text-slate-400 text-sm font-medium mt-1 animate-in fade-in duration-500 delay-150">
            Up Next: {nextPlayer}
          </p>
        </div>

        <div 
          key={animKey} 
          className="card-enter w-full max-w-sm aspect-[3/4] rounded-[2.5rem] p-1 relative group"
        >
          <div className={`absolute inset-0 bg-gradient-to-br ${deck.color} rounded-[2.5rem] opacity-50 dark:opacity-70 group-hover:opacity-80 dark:group-hover:opacity-100 transition-opacity blur-[2px]`}></div>
          
          <div className="relative h-full w-full bg-white dark:bg-slate-900 rounded-[2.3rem] p-6 sm:p-8 flex flex-col shadow-xl">
            <div className="flex justify-between items-center mb-4 shrink-0">
              <span className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-white text-xs font-bold px-3 py-1.5 rounded-full uppercase tracking-wider shadow-sm">
                {card?.type}
              </span>
              {card?.severity && renderSeverity(card.severity)}
            </div>

            <div className="flex-1 overflow-y-auto hide-scrollbar py-2 flex flex-col">
              <div className="my-auto">
                <h2 className="text-2xl sm:text-3xl font-bold text-center leading-snug text-slate-900 dark:text-white">
                  {card?.text}
                </h2>
              </div>
            </div>

            <div className="mt-4 flex justify-center opacity-30 dark:opacity-50 text-slate-900 dark:text-white shrink-0">
              <Wine size={24} className="-rotate-12" />
            </div>
          </div>
        </div>

        <div className="mt-8 w-full max-w-sm flex flex-col items-center gap-3">
          
          {deck?.id === 'neverHaveIEver' && (
            <div className="flex gap-3 w-full animate-in fade-in slide-in-from-bottom-2 mb-2">
              <button
                onClick={() => { SoundEngine.alarm(); setNhieAction('tea'); }}
                className="flex-1 py-3 rounded-xl bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400 font-bold text-sm flex justify-center items-center gap-2 hover:bg-purple-200 dark:hover:bg-purple-500/30 transition-colors"
              >
                <MessageCircle size={18} /> Spill Tea
              </button>
              <button
                onClick={() => { SoundEngine.alarm(); setNhieAction('callout'); }}
                className="flex-1 py-3 rounded-xl bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400 font-bold text-sm flex justify-center items-center gap-2 hover:bg-red-200 dark:hover:bg-red-500/30 transition-colors"
              >
                <Flame size={18} /> Call Out
              </button>
            </div>
          )}

          {card?.requiresCustomInput ? (
            !customRuleSaved ? (
              <div className="w-full flex flex-col gap-2 animate-in fade-in slide-in-from-bottom-2">
                <input 
                  type="text"
                  value={customRuleInput}
                  onChange={(e) => setCustomRuleInput(e.target.value)}
                  placeholder="Type the new rule here..."
                  className="w-full bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-xl py-3 px-4 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-orange-500 transition-colors shadow-sm"
                />
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    if (customRuleInput.trim()) {
                      SoundEngine.success();
                      setActiveRules([...activeRules, { type: 'Custom', baseText: `custom_rule_${Date.now()}`, text: `${player}'s Rule: ${customRuleInput.trim()}`, owner: player, canCancel: true }]);
                      setCustomRuleSaved(true);
                    }
                  }}
                  disabled={!customRuleInput.trim()}
                  className="w-full py-3 rounded-xl bg-orange-100 dark:bg-orange-500/20 text-orange-600 dark:text-orange-400 font-bold text-sm hover:bg-orange-200 dark:hover:bg-orange-500/30 transition-colors disabled:opacity-50 flex justify-center items-center gap-2"
                >
                  <Gavel size={16} /> Save Custom Rule
                </button>
              </div>
            ) : (
              <div className="px-6 py-2 rounded-full border-2 border-green-500/50 text-green-600 dark:text-green-400 font-bold text-sm flex items-center gap-2 animate-in zoom-in duration-300">
                <Sparkles size={16} /> Rule Saved!
              </div>
            )
          ) : card?.isOngoing ? (
            <div className="px-6 py-2 rounded-full border-2 border-orange-500/50 text-orange-600 dark:text-orange-400 font-bold text-sm flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2">
              <Gavel size={16} /> Rule Auto-Saved
            </div>
          ) : card?.type === 'Rule' && !activeRules.some((r: ActiveRule) => r.baseText === card?.baseText) ? (
            <button 
              onClick={handleAddCurrentCardAsRule}
              className="px-6 py-2 rounded-full border-2 border-orange-500/50 text-orange-600 dark:text-orange-400 font-bold text-sm hover:bg-orange-500/10 transition-colors flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2"
            >
              <Gavel size={16} /> Save as Active Rule
            </button>
          ) : null}

          <button 
            onClick={handleNextTurnClick}
            className="w-full bg-gradient-to-r from-orange-500 to-amber-500 text-white font-bold text-lg py-4 rounded-full shadow-lg shadow-orange-900/20 active:scale-95 transition-all flex items-center justify-center gap-2 mt-2"
          >
            Next Card <ChevronRight size={20} />
          </button>
        </div>
      </div>

      {showRulesModal && (
        <div className="absolute inset-0 z-50 bg-slate-900/40 dark:bg-slate-950/80 backdrop-blur-sm flex flex-col p-6 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-3xl p-6 w-full max-w-md mx-auto shadow-2xl flex flex-col max-h-full mt-auto mb-auto">
            <div className="flex justify-between items-center mb-6 shrink-0">
              <h3 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Gavel className="text-orange-500" /> Active Rules
              </h3>
              <button onClick={() => { SoundEngine.click(); setShowRulesModal(false); }} className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition">
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto hide-scrollbar mb-4 flex flex-col gap-3 min-h-[150px]">
              {activeRules.length === 0 ? (
                <div className="text-center text-slate-400 dark:text-slate-500 my-auto py-8 flex flex-col items-center">
                  <Gavel size={32} className="opacity-20 mb-2" />
                  <p className="italic">No active rules yet. Add some chaos!</p>
                </div>
              ) : (
                activeRules.map((rule: ActiveRule, idx: number) => (
                  <div key={idx} className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 flex gap-3 items-start animate-in slide-in-from-bottom-2">
                    <div className="flex-1 text-sm font-medium text-slate-800 dark:text-slate-200 leading-relaxed">{rule.text}</div>
                    <button onClick={() => removeRule(rule)} className="text-slate-400 hover:text-red-500 transition-colors shrink-0 p-1">
                      <Trash2 size={18} />
                    </button>
                  </div>
                ))
              )}
            </div>

            <form onSubmit={addCustomRule} className="relative mt-4 shrink-0">
              <input
                type="text"
                value={newRuleText}
                onChange={e => setNewRuleText(e.target.value)}
                placeholder="Write a custom rule..."
                className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl py-3 pl-4 pr-12 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-orange-500 transition-colors"
              />
              <button type="submit" disabled={!newRuleText.trim()} className="absolute right-2 top-2 bottom-2 text-orange-500 disabled:opacity-50 hover:scale-110 transition-transform">
                <PlusCircle size={24} />
              </button>
            </form>
          </div>
        </div>
      )}

      {nhieAction && (
        <div className="absolute inset-0 z-50 bg-slate-900/60 dark:bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-3xl p-8 w-full max-w-sm text-center shadow-2xl">
             <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${nhieAction === 'tea' ? 'bg-purple-100 dark:bg-purple-900/50 text-purple-500' : 'bg-red-100 dark:bg-red-900/50 text-red-500'}`}>
               {nhieAction === 'tea' ? <MessageCircle size={32} /> : <Flame size={32} />}
             </div>
             <h3 className="text-2xl font-black text-slate-900 dark:text-white mb-2">
                {nhieAction === 'tea' ? 'Spill the Tea!' : 'Call Out a Liar!'}
             </h3>
             <p className="text-slate-600 dark:text-slate-300 mb-8 font-medium">
               {nhieAction === 'tea' 
                 ? <span>The group picks one person who drank. They MUST tell the full backstory.<br/><br/><span className="text-purple-500 font-bold">Refuse to speak? Take 3 penalty sips!</span></span>
                 : <span>Point to the person you think is lying about NOT drinking. If the group agrees they are lying...<br/><br/><span className="text-red-500 font-bold">They must FINISH their drink!</span></span>
               }
             </p>
             <button onClick={() => { SoundEngine.click(); setNhieAction(null); }} className="w-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold py-4 rounded-xl active:scale-95 transition-transform">
               Got it
             </button>
          </div>
        </div>
      )}

      {showTurnReviewModal && (
        <div className="absolute inset-0 z-50 bg-slate-900/60 dark:bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-3xl p-6 w-full max-w-sm text-center shadow-2xl flex flex-col max-h-[80vh]">
            <div className="w-16 h-16 bg-orange-100 dark:bg-orange-900/50 rounded-full flex items-center justify-center mx-auto mb-4 text-orange-500">
               <RefreshCcw size={32} />
            </div>
            <h3 className="text-2xl font-black text-slate-900 dark:text-white mb-2">
              {nextPlayer}'s Turn Update
            </h3>
            <p className="text-slate-600 dark:text-slate-400 text-sm mb-6">
              {nextPlayerCancellable.length > 0 && nextPlayerExpiring.length > 0
                ? "Some rules have ended. Do you want to cancel the rest?"
                : nextPlayerExpiring.length > 0
                ? "These rules have officially ended!"
                : "You have active rules. Cancel them, or keep the chaos going?"}
            </p>
            
            <div className="flex-1 overflow-y-auto hide-scrollbar mb-6 flex flex-col gap-3 text-left">
              
              {nextPlayerExpiring.length > 0 && (
                <div className="mb-2">
                  <h4 className="text-xs font-bold text-green-500 uppercase tracking-wider mb-2">Rules Ended</h4>
                  {nextPlayerExpiring.map((rule: ActiveRule, idx: number) => (
                    <div key={`exp-${idx}`} className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/50 rounded-2xl p-4 flex gap-3 items-center">
                      <div className="flex-1 text-sm font-medium text-green-800 dark:text-green-300 leading-relaxed opacity-75 line-through">{rule.text}</div>
                      <CheckCircle size={18} className="text-green-500 shrink-0" />
                    </div>
                  ))}
                </div>
              )}

              {nextPlayerCancellable.length > 0 && (
                <div className="mb-2">
                  <h4 className="text-xs font-bold text-orange-500 uppercase tracking-wider mb-2">Keep or Cancel?</h4>
                  {nextPlayerCancellable.map((rule: ActiveRule, idx: number) => (
                    <div key={`can-${idx}`} className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 flex gap-3 items-center">
                      <div className="flex-1 text-sm font-medium text-slate-800 dark:text-slate-200 leading-relaxed">{rule.text}</div>
                      <button 
                        onClick={() => removeRule(rule)} 
                        className="text-red-500 hover:bg-red-100 dark:hover:bg-red-500/20 p-2 rounded-lg transition-colors shrink-0"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

            </div>

            <button 
              onClick={() => {
                if (nextPlayerExpiring.length > 0) {
                  setActiveRules((prev: ActiveRule[]) => prev.filter((r: ActiveRule) => !(r.owner === nextPlayer && r.expiresNextTurn)));
                }
                SoundEngine.click();
                setShowTurnReviewModal(false);
                nextTurn();
              }}
              className="w-full bg-gradient-to-r from-orange-500 to-amber-500 text-white font-bold py-4 rounded-xl active:scale-95 transition-transform"
            >
              Start Turn
            </button>
          </div>
        </div>
      )}
    </div>
  );
}