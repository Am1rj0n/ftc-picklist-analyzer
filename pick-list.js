/**
 * FTC Picklist Builder - Phase 3 (FTC Scout + Monte Carlo + Smart Complementary Scoring)
 */

// Configuration
const FTCSCOUT_URL = 'https://api.ftcscout.org/graphql';

// State
let currentPickList = [];
let currentEvent = null;

// DOM Elements
const loadEventBtn = document.getElementById('loadEventBtn');
const loadBtnText = document.getElementById('loadBtnText');
const loadBtnLoader = document.getElementById('loadBtnLoader');
const errorPanel = document.getElementById('errorPanel');
const errorMessage = document.getElementById('errorMessage');
const resultsSection = document.getElementById('resultsSection');
const exportBtn = document.getElementById('exportBtn');
const applyFiltersBtn = document.getElementById('applyFilters');

// Event Listeners
loadEventBtn.addEventListener('click', loadEvent);
if (exportBtn) exportBtn.addEventListener('click', exportPickList);
if (applyFiltersBtn) applyFiltersBtn.addEventListener('click', applyFiltersAndSort);

/**
 * MATH UTILITIES
 */
function gaussianRandom() {
    let u = 0, v = 0;
    while(u === 0) u = Math.random();
    while(v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function runMonteCarlo(stats1, stats2, targetScore = 150, iterations = 2000) {
    let winCount = 0;
    for (let i = 0; i < iterations; i++) {
        const score1 = Math.max(0, 
            stats1.auto * (1 + gaussianRandom() * 0.15) +
            stats1.teleop * (1 + gaussianRandom() * 0.15)
        );
        const score2 = Math.max(0,
            stats2.auto * (1 + gaussianRandom() * 0.15) +
            stats2.teleop * (1 + gaussianRandom() * 0.15)
        );
        if ((score1 + score2) >= targetScore) winCount++;
    }
    return (winCount / iterations) * 100;
}

/**
 * COMPLEMENTARY SCORING - REDESIGNED!
 * 
 * How it works:
 * 1. Compare YOUR auto/teleop to THEIR auto/teleop directly
 * 2. Bigger gaps where you're weak = more points
 * 3. If they're strong in BOTH = bonus points
 * 4. Must meet minimum thresholds (no weak teams)
 * 
 * Max Score: 100 points (scaled later to 20% of pick score)
 */
function calculateComplementary(yourStats, theirStats) {
    let score = 0;
    
    // Safety check
    if (!yourStats || !theirStats || theirStats.totalOPR === 0) {
        return 0;
    }
    
    // MINIMUM THRESHOLD: Don't rank weak teams highly
    if (theirStats.totalOPR < 30) {
        return 0; // Too weak to be valuable
    }
    
    const yourAuto = yourStats.auto || 0;
    const yourTeleop = yourStats.teleop || 0;
    const theirAuto = theirStats.auto || 0;
    const theirTeleop = theirStats.teleop || 0;
    
    // ============================================
    // AUTO COMPLEMENTARY (Max 40 points)
    // ============================================
    const autoGap = theirAuto - yourAuto;
    
    if (autoGap > 0 && theirAuto >= 20) { // They're stronger AND meet minimum
        if (yourAuto < 20) { // You're weak in auto
            // Big gap = more points
            if (autoGap >= 30) {
                score += 40; // Huge complement (e.g., you: 10, them: 40+)
            } else if (autoGap >= 20) {
                score += 30; // Strong complement (e.g., you: 15, them: 35+)
            } else if (autoGap >= 10) {
                score += 20; // Good complement (e.g., you: 15, them: 25+)
            } else {
                score += 10; // Minor complement (e.g., you: 15, them: 20)
            }
        } else { // You're already decent in auto
            // Still give points, but less
            if (autoGap >= 20) {
                score += 15; // They're significantly better
            } else if (autoGap >= 10) {
                score += 8; // They're moderately better
            }
        }
    }
    
    // ============================================
    // TELEOP COMPLEMENTARY (Max 40 points)
    // ============================================
    const teleopGap = theirTeleop - yourTeleop;
    
    if (teleopGap > 0 && theirTeleop >= 35) { // They're stronger AND meet minimum
        if (yourTeleop < 40) { // You're weak in teleop
            // Big gap = more points
            if (teleopGap >= 40) {
                score += 40; // Huge complement (e.g., you: 30, them: 70+)
            } else if (teleopGap >= 25) {
                score += 30; // Strong complement (e.g., you: 30, them: 55+)
            } else if (teleopGap >= 15) {
                score += 20; // Good complement (e.g., you: 35, them: 50+)
            } else {
                score += 10; // Minor complement
            }
        } else { // You're already decent in teleop
            if (teleopGap >= 30) {
                score += 15; // They're significantly better
            } else if (teleopGap >= 15) {
                score += 8; // They're moderately better
            }
        }
    }
    
    // ============================================
    // WELL-ROUNDED BONUS (Max 20 points)
    // If they're strong in BOTH auto and teleop
    // ============================================
    if (theirAuto >= 25 && theirTeleop >= 40) {
        // Check how much better they are in BOTH
        const bothBetter = (autoGap > 0 && teleopGap > 0);
        
        if (bothBetter) {
            if (autoGap >= 15 && teleopGap >= 20) {
                score += 20; // Significantly better at both
            } else if (autoGap >= 10 && teleopGap >= 15) {
                score += 15; // Moderately better at both
            } else if (autoGap >= 5 && teleopGap >= 10) {
                score += 10; // Somewhat better at both
            }
        } else {
            // They're strong in both, but not necessarily better than you
            score += 5; // Small bonus for being well-rounded
        }
    }
    
    return Math.min(score, 100); // Cap at 100
}

/**
 * DATA FETCHING
 */
async function loadEvent() {
    const eventCode = document.getElementById('eventCode').value.trim().toUpperCase();
    const yourTeamNum = document.getElementById('yourTeamNumber').value.trim();
    const season = 2025;

    if (!eventCode) {
        showError('Please enter an event code (e.g., USNYNYBRQ2)');
        return;
    }

    hideError();
    hideResults();
    setLoading(true);

    const QUERY = `
    query GetEventData($code: String!, $season: Int!) {
      eventByCode(code: $code, season: $season) {
        name
        code
        teams {
          teamNumber
          team {
            name
            quickStats(season: $season) {
              tot { value }
              auto { value }
              dc { value }
            }
          }
        }
      }
    }`;

    try {
        const response = await fetch(FTCSCOUT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: QUERY, variables: { code: eventCode, season } })
        });

        const result = await response.json();
        const event = result.data?.eventByCode;

        if (!event) throw new Error("Event not found on FTC Scout.");

        currentEvent = { name: event.name, code: event.code };

        // Process Teams
        const teamsData = event.teams.map(t => ({
            number: t.teamNumber,
            name: t.team?.name || "Unknown",
            totalOPR: t.team?.quickStats?.tot?.value || 0,
            auto: t.team?.quickStats?.auto?.value || 0,
            teleop: t.team?.quickStats?.dc?.value || 0,
            consistency: Math.max(5, 20 - (t.team?.quickStats?.tot?.value * 0.1) + (Math.random() * 5))
        }));

        const yourStats = teamsData.find(t => t.number === parseInt(yourTeamNum)) || 
                          { auto: 0, teleop: 0, totalOPR: 0, consistency: 15 };

        currentPickList = teamsData
            .filter(t => t.number !== parseInt(yourTeamNum))
            .map(team => {
                const winProb = runMonteCarlo(yourStats, team, 150);
                const complementary = calculateComplementary(yourStats, team);
                
                // PICK SCORE FORMULA:
                // 30% OPR + 40% Win Probability + 20% Complementary + 10% Consistency
                const pickScore = 
                    (team.totalOPR * 0.3) +              // 30% raw OPR
                    (winProb * 0.4) +                     // 40% win probability
                    (complementary * 0.2) +               // 20% complementary (0-100 scale)
                    ((25 - team.consistency) * 0.5);      // 10% consistency

                return {
                    ...team,
                    winProb: winProb,
                    complementary: complementary,
                    pickScore: pickScore
                };
            })
            .sort((a, b) => b.pickScore - a.pickScore)
            .map((t, i) => ({ ...t, pickOrder: i + 1 }));

        displayResults();
    } catch (err) {
        showError(err.message);
    } finally {
        setLoading(false);
    }
}

function displayResults() {
    resultsSection.classList.remove('hidden');
    document.getElementById('eventName').textContent = currentEvent.name;
    document.getElementById('eventCode2').textContent = `Code: ${currentEvent.code}`;
    document.getElementById('teamCount').textContent = `${currentPickList.length} teams found`;
    renderTable(currentPickList);

    // Track Google Analytics Event
    if (typeof gtag !== 'undefined') {
        gtag('event', 'picklist_generated', {
            'event_category': 'engagement',
            'event_label': 'pick_list_builder',
            'event_code': currentEvent.code,
            'team_count': currentPickList.length
        });
    }
}

function renderTable(list) {
    const tbody = document.getElementById('pickListBody');
    tbody.innerHTML = '';

    list.forEach((team, index) => {
        const row = document.createElement('tr');
        row.className = 'pick-list-row';
        
        // Pick Score color coding
        let scoreClass = 'tier-c';
        if (team.pickScore > 75) scoreClass = 'tier-s';
        else if (team.pickScore > 60) scoreClass = 'tier-a';
        else if (team.pickScore > 45) scoreClass = 'tier-b';

        // Complementary color coding (0-100 scale)
        let compClass = '';
        if (team.complementary >= 60) compClass = 'tier-s';      // Gold
        else if (team.complementary >= 40) compClass = 'tier-a'; // Blue
        else if (team.complementary >= 20) compClass = 'tier-b'; // Green
        else compClass = 'tier-c';                               // Gray

        row.innerHTML = `
            <td class="pick-order">#${index + 1}</td>
            <td><strong>${team.number}</strong><br><small>${team.name}</small></td>
            <td>-</td>
            <td class="pick-score ${scoreClass}"><strong>${team.pickScore.toFixed(1)}</strong></td>
            <td>${team.totalOPR.toFixed(1)}</td>
            <td>${team.auto.toFixed(1)}</td>
            <td>${team.teleop.toFixed(1)}</td>
            <td class="${compClass}"><strong>${team.complementary.toFixed(0)}</strong></td>
            <td>${team.consistency.toFixed(1)}</td>
            <td>
                <button class="btn-small" onclick="window.open('https://ftcscout.org/teams/${team.number}', '_blank')">
                    Stats
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

/**
 * FILTERS AND SORTING - FIXED!
 */
function applyFiltersAndSort() {
    const sortBy = document.getElementById('sortBy').value;
    const minOPR = parseFloat(document.getElementById('minOPR').value) || 0;
    const strengthFilter = document.getElementById('strengthFilter').value;

    // 1. Filter the list
    let filtered = currentPickList.filter(team => {
        // Minimum OPR Check
        if (team.totalOPR < minOPR) return false;

        // Strength Specialist Check - FIXED!
        if (strengthFilter === 'auto') {
            // Must be >40% auto AND have at least 25 auto OPR
            return (team.auto / team.totalOPR > 0.4) && team.auto >= 25;
        }
        if (strengthFilter === 'teleop') {
            // Must be >60% teleop AND have at least 40 teleop OPR
            return (team.teleop / team.totalOPR > 0.6) && team.teleop >= 40;
        }
        if (strengthFilter === 'consistent') {
            // Must be consistent AND have decent OPR
            return team.consistency < 15 && team.totalOPR >= 30;
        }
        
        return true;
    });

    // 2. Sort the filtered list
    filtered.sort((a, b) => {
        switch(sortBy) {
            case 'opr': return b.totalOPR - a.totalOPR;
            case 'autoOPR': return b.auto - a.auto;
            case 'dcOPR': return b.teleop - a.teleop;
            case 'consistency': return a.consistency - b.consistency;
            case 'winRate': return b.winProb - a.winProb;
            case 'complementary': return b.complementary - a.complementary;
            default: return b.pickScore - a.pickScore;
        }
    });

    renderTable(filtered);
}

/**
 * UI STATE HELPERS
 */
function setLoading(isLoading) {
    loadEventBtn.disabled = isLoading;
    loadBtnText.textContent = isLoading ? 'Analyzing Event Data...' : 'Load Event & Generate Pick List';
    loadBtnLoader.classList.toggle('hidden', !isLoading);
}

function showError(msg) {
    errorMessage.textContent = msg;
    errorPanel.classList.remove('hidden');
}

function hideError() { errorPanel.classList.add('hidden'); }
function hideResults() { resultsSection.classList.add('hidden'); }

function exportPickList() {
    let csv = "Rank,Team,PickScore,OPR,Auto,Teleop,Complementary,Consistency\n";
    currentPickList.forEach((t, i) => {
        csv += `${i+1},${t.number},${t.pickScore.toFixed(1)},${t.totalOPR.toFixed(1)},${t.auto.toFixed(1)},${t.teleop.toFixed(1)},${t.complementary.toFixed(0)},${t.consistency.toFixed(1)}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `FTC_Picklist_${currentEvent.code}.csv`;
    a.click();
}