/**
 * FTC Picklist Builder - Phase 3 (FTC Scout + Monte Carlo)
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
            // Consistency simulated as a lower value is better (like standard deviation)
            consistency: Math.max(5, 20 - (t.team?.quickStats?.tot?.value * 0.1) + (Math.random() * 5))
        }));

        const yourStats = teamsData.find(t => t.number === parseInt(yourTeamNum)) || 
                          { auto: 0, teleop: 0, totalOPR: 0 };

        currentPickList = teamsData
            .filter(t => t.number !== parseInt(yourTeamNum))
            .map(team => {
                const winProb = runMonteCarlo(yourStats, team, 150);
                const pickScore = (team.totalOPR * 0.4) + (winProb * 0.4) + ((25 - team.consistency) * 0.8);

                return {
                    ...team,
                    winProb: winProb,
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
        
        let scoreClass = 'tier-c';
        if (team.pickScore > 75) scoreClass = 'tier-s';
        else if (team.pickScore > 50) scoreClass = 'tier-a';

        row.innerHTML = `
            <td class="pick-order">#${index + 1}</td>
            <td><strong>${team.number}</strong><br><small>${team.name}</small></td>
            <td>-</td>
            <td class="pick-score ${scoreClass}"><strong>${team.pickScore.toFixed(1)}</strong></td>
            <td>${team.totalOPR.toFixed(1)}</td>
            <td>${team.auto.toFixed(1)}</td>
            <td>${team.teleop.toFixed(1)}</td>
            <td>-</td>
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
 *FILTERS AND SORTING
 */
function applyFiltersAndSort() {
    const sortBy = document.getElementById('sortBy').value;
    const minOPR = parseFloat(document.getElementById('minOPR').value) || 0;
    const strengthFilter = document.getElementById('strengthFilter').value;

    // 1. Filter the list
    let filtered = currentPickList.filter(team => {
        // Minimum OPR Check
        if (team.totalOPR < minOPR) return false;

        // Strength Specialist Check
        if (strengthFilter === 'auto') {
            return team.auto > (team.totalOPR * 0.4); // Must contribute >40% in auto
        }
        if (strengthFilter === 'teleop') {
            return team.teleop > (team.totalOPR * 0.6); // Must contribute >60% in teleop
        }
        if (strengthFilter === 'consistent') {
            return team.consistency < 15; // Lower is better
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
    let csv = "Rank,Team,PickScore,OPR,Auto,Teleop\n";
    currentPickList.forEach((t, i) => {
        csv += `${i+1},${t.number},${t.pickScore.toFixed(1)},${t.totalOPR.toFixed(1)},${t.auto.toFixed(1)},${t.teleop.toFixed(1)}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `FTC_Picklist.csv`;
    a.click();
}