// Content script that runs on DuckWeb pages
console.log('RateMyProfessor Extension loaded on DuckWeb');

// Cache for professor ratings to avoid repeated API calls
const ratingCache = {};

function findStudentReview(){

}
// Function to find all table rows with course information
function findProfessorCells() {
  const professorCells = [];
  
  // Find all table rows in the course listing
  const rows = document.querySelectorAll('tr');
  
  rows.forEach(row => {
    // Get all cells in the row
    const cells = row.querySelectorAll('td.dddefault');
    
    // The instructor cell is typically the 11th cell (index 10)
    // Format: "FirstName LastName (P)" or "FirstName LastName"
    if (cells.length >= 11) {
      const instructorCell = cells[10];
      const instructorText = instructorCell.textContent.trim();
      
      // Check if this cell contains an instructor name
      // Skip cells with "TBA", "Staff", or empty
      if (instructorText && 
          instructorText !== 'TBA' && 
          !instructorText.toLowerCase().includes('staff') &&
          instructorText.length > 2) {
        
        professorCells.push({
          cell: instructorCell,
          text: instructorText
        });
      }
    }
  });
  
  return professorCells;
}

// Function to extract professor name from the cell text
function extractProfessorName(text) {
  // Remove the "(P)" indicator for primary instructor
  let name = text.replace(/\([^)]*\)/g, '').trim();
  
  // Remove any extra whitespace
  name = name.replace(/\s+/g, ' ').trim();
  
  return name;
}

// Function to create and insert rating badge
function createRatingBadge(professorName, ratingData) {
  const badge = document.createElement('div');
  badge.className = 'rmp-rating-badge';
  
  if (ratingData.success) {
    const { rating, numRatings, wouldTakeAgain, difficulty } = ratingData.data;
    
    // Determine rating color
    let ratingColor = '#4CAF50'; // green
    if (rating < 3) ratingColor = '#f44336'; // red
    else if (rating < 4) ratingColor = '#ff9800'; // orange
    
    badge.innerHTML = `
      <div class="rmp-badge-main" style="background-color: ${ratingColor}">
        ⭐ ${rating ? rating.toFixed(1) : 'N/A'}
      </div>
      <div class="rmp-badge-details">
        ${numRatings || 0} rating${numRatings !== 1 ? 's' : ''}
        ${wouldTakeAgain ? `<br>${wouldTakeAgain.toFixed(0)}% would take again` : ''}
        ${difficulty ? `<br>Difficulty: ${difficulty.toFixed(1)}/5` : ''}
      </div>
    `;
    
    badge.title = `Click to view ${professorName} on RateMyProfessor`;
    badge.style.cursor = 'pointer';
    badge.onclick = () => {
      window.open(`https://www.ratemyprofessors.com/professor/${ratingData.data.id}`, '_blank');
    };
  } else {
    badge.innerHTML = `<div class="rmp-badge-main rmp-not-found">Not on RMP</div>`;
    badge.title = 'Professor not found on RateMyProfessor';
  }
  
  return badge;
}

// Function to process a professor cell
async function processProfessorCell(profCell) {
  const professorName = extractProfessorName(profCell.text);
  
  if (!professorName || professorName.length < 3) {
    return; // Skip invalid names
  }
  
  // Check if we've already processed this cell
  if (profCell.cell.querySelector('.rmp-rating-badge')) {
    return;
  }
  
  // Check cache first
  if (ratingCache[professorName]) {
    const badge = createRatingBadge(professorName, ratingCache[professorName]);
    
    // Store original content
    const originalContent = profCell.cell.innerHTML;
    
    // Create wrapper to organize content
    const wrapper = document.createElement('div');
    wrapper.style.display = 'flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.gap = '10px';
    
    const nameSpan = document.createElement('span');
    nameSpan.innerHTML = originalContent;
    
    wrapper.appendChild(nameSpan);
    wrapper.appendChild(badge);
    
    profCell.cell.innerHTML = '';
    profCell.cell.appendChild(wrapper);
    return;
  }
  
  // Create loading indicator
  const loadingBadge = document.createElement('div');
  loadingBadge.className = 'rmp-rating-badge rmp-loading';
  loadingBadge.innerHTML = '<div class="rmp-badge-main" style="background-color: #2196F3">...</div>';
  
  // Store original content and add loading badge
  const originalContent = profCell.cell.innerHTML;
  const wrapper = document.createElement('div');
  wrapper.style.display = 'flex';
  wrapper.style.alignItems = 'center';
  wrapper.style.gap = '10px';
  
  const nameSpan = document.createElement('span');
  nameSpan.innerHTML = originalContent;
  
  wrapper.appendChild(nameSpan);
  wrapper.appendChild(loadingBadge);
  
  profCell.cell.innerHTML = '';
  profCell.cell.appendChild(wrapper);
  
  // Request rating from background script
  chrome.runtime.sendMessage(
    { action: 'getProfessorRating', professorName: professorName },
    (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error:', chrome.runtime.lastError);
        loadingBadge.remove();
        return;
      }
      
      // Cache the response
      ratingCache[professorName] = response;
      
      // Replace loading badge with actual rating
      loadingBadge.remove();
      const badge = createRatingBadge(professorName, response);
      wrapper.appendChild(badge);
    }
  );
}

// Main function to run the extension
async function init() {
  const professorCells = findProfessorCells();
  
  console.log(`Found ${professorCells.length} professor cells`);
  
  // Process each professor cell with a small delay to avoid rate limiting
  for (let i = 0; i < professorCells.length; i++) {
    await processProfessorCell(professorCells[i]);
    // Small delay between requests (200ms)
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

// Run when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  // Add a small delay to ensure the table is fully rendered
  setTimeout(init, 500);
}

// Watch for dynamic content changes (if DuckWeb uses AJAX)
const observer = new MutationObserver((mutations) => {
  // Only reinitialize if significant changes occurred
  const significantChange = mutations.some(mutation => 
    mutation.addedNodes.length > 0 && 
    Array.from(mutation.addedNodes).some(node => 
      node.nodeType === 1 && (node.tagName === 'TR' || node.tagName === 'TABLE')
    )
  );
  
  if (significantChange) {xw
    clearTimeout(window.rmpInitTimeout);
    window.rmpInitTimeout = setTimeout(init, 500);
  }
});

// Only observe if the body exists
if (document.body) {
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}
