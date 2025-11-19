const express = require('express');
const axios = require('axios');
const router = express.Router();

const RAILWAY_API_URL = 'https://backboard.railway.app/graphql/v2';

// Get deployments with proper project token query structure
const DEPLOYMENTS_QUERY = `
  query GetDeployments($projectId: String!, $environmentId: String!, $serviceId: String!) {
    deployments(
      first: 1
      input: {
        projectId: $projectId
        environmentId: $environmentId
        serviceId: $serviceId
      }
    ) {
      edges {
        node {
          id
          status
          staticUrl
          createdAt
          meta {
            name
            value
          }
        }
      }
    }
  }
`;

// Get service info
const SERVICES_QUERY = `
  query GetServices($projectId: String!, $environmentId: String!) {
    services(projectId: $projectId, environmentId: $environmentId) {
      id
      name
      url
    }
  }
`;

// Get latest deployment status
router.get('/status', async (req, res) => {
  try {
    // First get token info to get projectId and environmentId
    const tokenInfo = await getTokenInfo();
    
    if (!tokenInfo.success) {
      return res.json({
        status: 'ERROR',
        message: 'Cannot get token info'
      });
    }

    // Get services to find the service ID
    const servicesResponse = await axios.post(
      RAILWAY_API_URL,
      {
        query: SERVICES_QUERY,
        variables: {
          projectId: tokenInfo.projectId,
          environmentId: tokenInfo.environmentId
        }
      },
      {
        headers: {
          'Project-Access-Token': process.env.RAILWAY_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('Services response:', JSON.stringify(servicesResponse.data, null, 2));

    if (servicesResponse.data.errors) {
      return res.json({
        status: 'API_ERROR',
        message: 'Failed to get services',
        errors: servicesResponse.data.errors
      });
    }

    const services = servicesResponse.data.data?.services;
    
    if (!services || services.length === 0) {
      return res.json({
        status: 'NO_SERVICES',
        message: 'No services found'
      });
    }

    // Use the first service ID
    const serviceId = services[0].id;

    // Now get deployments
    const deploymentsResponse = await axios.post(
      RAILWAY_API_URL,
      {
        query: DEPLOYMENTS_QUERY,
        variables: {
          projectId: tokenInfo.projectId,
          environmentId: tokenInfo.environmentId,
          serviceId: serviceId
        }
      },
      {
        headers: {
          'Project-Access-Token': process.env.RAILWAY_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('Deployments response:', JSON.stringify(deploymentsResponse.data, null, 2));

    if (deploymentsResponse.data.errors) {
      return res.json({
        status: 'API_ERROR',
        message: 'Failed to get deployments',
        errors: deploymentsResponse.data.errors
      });
    }

    const deployments = deploymentsResponse.data.data?.deployments?.edges;
    
    if (!deployments || deployments.length === 0) {
      return res.json({
        status: 'NO_DEPLOYMENTS',
        message: 'No deployments found',
        serviceUrl: services[0]?.url // Return service URL even if no deployments
      });
    }

    const latestDeployment = deployments[0].node;
    const serviceUrl = services[0]?.url || latestDeployment.staticUrl;

    res.json({
      status: latestDeployment.status || 'SUCCESS', // Default to success if no status
      createdAt: latestDeployment.createdAt,
      deploymentId: latestDeployment.id,
      url: serviceUrl,
      staticUrl: latestDeployment.staticUrl,
      serviceId: serviceId
    });

  } catch (error) {
    console.error('Railway API error:', error.response?.data || error.message);
    
    res.json({
      status: 'ERROR',
      message: 'Failed to fetch deployment status',
      details: error.response?.data || error.message
    });
  }
});

// Get services list
router.get('/services', async (req, res) => {
  try {
    const tokenInfo = await getTokenInfo();
    
    const response = await axios.post(
      RAILWAY_API_URL,
      {
        query: SERVICES_QUERY,
        variables: {
          projectId: tokenInfo.projectId,
          environmentId: tokenInfo.environmentId
        }
      },
      {
        headers: {
          'Project-Access-Token': process.env.RAILWAY_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data.errors) {
      return res.json({
        success: false,
        message: 'Failed to get services',
        errors: response.data.errors
      });
    }

    const services = response.data.data?.services;
    
    res.json({
      success: true,
      services: services,
      message: 'Services retrieved successfully'
    });

  } catch (error) {
    res.json({
      success: false,
      message: 'Failed to fetch services',
      error: error.response?.data || error.message
    });
  }
});

// Helper function to get token info
async function getTokenInfo() {
  try {
    const response = await axios.post(
      'https://backboard.railway.app/graphql/v2',
      {
        query: 'query { projectToken { projectId environmentId } }'
      },
      {
        headers: {
          'Project-Access-Token': process.env.RAILWAY_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );

    const tokenInfo = response.data.data?.projectToken;
    
    if (!tokenInfo) {
      throw new Error('No token info received');
    }

    return {
      success: true,
      projectId: tokenInfo.projectId,
      environmentId: tokenInfo.environmentId
    };

  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = router;
