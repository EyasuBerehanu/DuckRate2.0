// Background service worker for handling RateMyProfessor API calls

const RMP_GRAPHQL_URL = 'https://www.ratemyprofessors.com/graphql';

// Cache school ID to avoid repeated lookups
let cachedSchoolId = null;

// GraphQL query to search for a school
const SCHOOL_SEARCH_QUERY = `
  query NewSearchSchoolsQuery($query: SchoolSearchQuery!) {
    newSearch {
      schools(query: $query) {
        edges {
          node {
            id
            legacyId
            name
          }
        }
      }
    }
  }
`;


// GraphQL query to search for professors
const PROFESSOR_SEARCH_QUERY = `
  query NewSearchTeachersQuery($query: TeacherSearchQuery!) {
    newSearch {
      teachers(query: $query) {
        edges {
          node {
            id
            legacyId
            firstName
            lastName
            school {
              name
              id
            }
            avgRating
            avgDifficulty
            numRatings
            wouldTakeAgainPercent
            department
          }
        }
      }
    }
  }
`;

// Function to make GraphQL requests with proper headers
async function makeGraphQLRequest(query, variables) {
  try {
    const response = await fetch(RMP_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        query: query,
        variables: variables
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`HTTP ${response.status}: ${errorText}`);
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.errors) {
      console.error('GraphQL errors:', data.errors);
      throw new Error('GraphQL query failed');
    }
    
    return data;
  } catch (error) {
    console.error('GraphQL request failed:', error);
    throw error;
  }
}

// Get University of Oregon school ID
async function getUOSchoolId() {
  // Return cached ID if available
  if (cachedSchoolId) {
    return cachedSchoolId;
  }
  
  try {
    const data = await makeGraphQLRequest(SCHOOL_SEARCH_QUERY, {
      query: {
        text: "University of Oregon"
      }
    });

    const schools = data.data?.newSearch?.schools?.edges;
    if (schools && schools.length > 0) {
      cachedSchoolId = schools[0].node.legacyId;
      console.log('Found UO School ID:', cachedSchoolId);
      return cachedSchoolId;
    }
    
    console.error('No schools found for University of Oregon');
    return null;
  } catch (error) {
    console.error('Failed to get UO school ID:', error);
    return null;
  }
}

// Search for a professor
async function searchProfessor(professorName, schoolId) {
  try {
    const data = await makeGraphQLRequest(PROFESSOR_SEARCH_QUERY, {
      query: {
        text: professorName,
        schoolID: btoa(`School-${schoolId}`)
      }
    });

    const teachers = data.data?.newSearch?.teachers?.edges;
    console.log(`Found ${teachers?.length || 0} results for "${professorName}"`);
    return teachers || [];
  } catch (error) {
    console.error('Failed to search professor:', error);
    return [];
  }
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getProfessorRating') {
    (async () => {
      try {
        console.log('Searching for professor:', request.professorName);
        
        // Get UO school ID (cached after first call)
        const schoolId = await getUOSchoolId();
        
        if (!schoolId) {
          sendResponse({ 
            success: false,
            error: 'Could not find University of Oregon on RateMyProfessor' 
          });
          return;
        }

        // Search for the professor
        const professors = await searchProfessor(request.professorName, schoolId);
        
        if (professors.length > 0) {
          const prof = professors[0].node;
          console.log('Found professor:', prof.firstName, prof.lastName);
          
          sendResponse({
            success: true,
            data: {
              name: `${prof.firstName} ${prof.lastName}`,
              rating: prof.avgRating,
              difficulty: prof.avgDifficulty,
              numRatings: prof.numRatings,
              wouldTakeAgain: prof.wouldTakeAgainPercent,
              department: prof.department,
              id: prof.legacyId
            }
          });
        } else {
          console.log('Professor not found on RMP');
          sendResponse({ 
            success: false, 
            message: 'Professor not found on RateMyProfessor' 
          });
        }
      } catch (error) {
        console.error('Error processing request:', error);
        sendResponse({ 
          success: false,
          error: error.message 
        });
      }
    })();
    
    return true; // Keep message channel open for async response
  }
});