// Content script that runs on DuckWeb pages
console.log('RateMyProfessor Extension loaded on DuckWeb');

// Cache for professor ratings to avoid repeated API calls
const ratingCache = {};

// Track if we've added the column header
let columnHeaderAdded = false;

// Function to find all table rows with course information
function findProfessorCells() {
  const professorCells = [];

  // Find the main results table
  const table = document.querySelector('#table1');
  if (!table) return professorCells;

  // Find all data rows (exclude header)
  const rows = table.querySelectorAll('tbody tr');

  rows.forEach(row => {
    // Find the instructor cell by data-property attribute
    const instructorCell = row.querySelector('td[data-property="instructor"]');

    if (instructorCell) {
      // Get the professor name from the anchor tag
      const instructorLink = instructorCell.querySelector('a.email');

      if (instructorLink) {
        const instructorText = instructorLink.textContent.trim();

        // Check if this cell contains an instructor name
        // Skip cells with "TBA", "Staff", or empty
        if (instructorText &&
            instructorText !== 'TBA' &&
            !instructorText.toLowerCase().includes('staff') &&
            instructorText.length > 2) {

          professorCells.push({
            row: row,
            cell: instructorCell,
            text: instructorText
          });
        }
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

// Function to add RMP Rating column header
function addRatingColumnHeader() {
  if (columnHeaderAdded) return;

  const table = document.querySelector('#table1');
  if (!table) return;

  const headerRow = table.querySelector('thead tr');
  if (!headerRow) return;

  // Find the instructor column header
  const instructorHeader = headerRow.querySelector('th[data-property="instructor"]');
  if (!instructorHeader) return;

  // Create new header for RMP Rating
  const rmpHeader = document.createElement('th');
  rmpHeader.scope = 'col';
  rmpHeader.setAttribute('data-sort-direction', 'disabled');
  rmpHeader.className = 'sort-disabled rmp-rating-col ui-state-default';
  rmpHeader.setAttribute('data-property', 'rmpRating');
  rmpHeader.setAttribute('xe-field', 'rmpRating');
  rmpHeader.setAttribute('style', 'width: 8%;');
  rmpHeader.setAttribute('data-hide', 'phone');

  // Create title div
  const titleDiv = document.createElement('div');
  titleDiv.className = 'title';
  titleDiv.title = 'RMP Rating';
  titleDiv.textContent = 'RMP Rating 🦆⭐';
  titleDiv.style.width = 'auto';

  // Create sort handle div (needed for proper layout)
  const sortHandle = document.createElement('div');
  sortHandle.className = 'sort-handle';
  sortHandle.style.height = '100%';
  sortHandle.style.width = '5px';
  sortHandle.style.cursor = 'w-resize';

  rmpHeader.appendChild(titleDiv);
  rmpHeader.appendChild(sortHandle);

  // Insert after instructor column
  instructorHeader.after(rmpHeader);

  columnHeaderAdded = true;
}

// Function to create rating badge for new column
function createRatingBadge(professorName, ratingData) {
  const badge = document.createElement('div');
  badge.className = 'rmp-rating-text';

  if (ratingData.success) {
    const { rating, numRatings, wouldTakeAgain, difficulty } = ratingData.data;

    // Determine rating color and emoji
    let ratingColor = '#4CAF50'; // green
    let ratingEmoji = '😄'; // happy
    if (rating < 3) {
      ratingColor = '#f44336'; // red
      ratingEmoji = '😡'; // angry
    } else if (rating < 4) {
      ratingColor = '#ff9800'; // orange
      ratingEmoji = '😐'; // neutral
    }

    badge.innerHTML = `
      <div class="rmp-rating-score" style="color: ${ratingColor}">
        ${rating ? rating.toFixed(1) : 'N/A'} ${ratingEmoji}
      </div>
      <div class="rmp-rating-details">
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
    badge.innerHTML = `<div class="rmp-rating-score">Not on RMP</div>`;
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

  // Check if we've already processed this row
  const existingRatingCell = profCell.row.querySelector('td[data-property="rmpRating"]');
  if (existingRatingCell) {
    return; // Already processed
  }

  // Create the new rating cell
  const ratingCell = document.createElement('td');
  ratingCell.setAttribute('data-property', 'rmpRating');
  ratingCell.setAttribute('xe-field', 'rmpRating');
  ratingCell.className = 'readonly';
  ratingCell.setAttribute('data-content', 'RMP Rating');
  ratingCell.style.width = '8%';

  // Insert the cell after the instructor cell
  profCell.cell.after(ratingCell);

  // Check cache first
  if (ratingCache[professorName]) {
    const badge = createRatingBadge(professorName, ratingCache[professorName]);
    ratingCell.appendChild(badge);
    return;
  }

  // Create loading indicator
  const loadingBadge = document.createElement('div');
  loadingBadge.className = 'rmp-rating-text rmp-loading';
  loadingBadge.innerHTML = '<div class="rmp-rating-score">...</div>';
  ratingCell.appendChild(loadingBadge);

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
      ratingCell.appendChild(badge);
    }
  );
}

// Main function to run the extension
async function init() {
  // Add the RMP Rating column header first
  addRatingColumnHeader();

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
  
  if (significantChange) {
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
