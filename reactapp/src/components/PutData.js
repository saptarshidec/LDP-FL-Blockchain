import React from 'react'

const PutData = (props) => {

    const setTextData=props.setTextData;
    const setWeights=props.setWeights;
    const PORT=process.env.REACT_APP_BACKEND_PORT | process.env.PORT+2000;

    const handleOnClick = async(e) => {
        e.preventDefault();
        try{
            const result=await fetch(`http://localhost:${PORT}/putweights`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                },
            });
            const data=await result.json();
            console.log(data);
            data.message+=". Here are first few weights: "+JSON.stringify(data.records)
            setTextData(data.message);
        }
        catch(err){
            console.log(err.message);
            setTextData(err.message);
        }
    }

    return (
        <div className='m-3'>
            <div className="btn btn-primary mt-1 mx-3" onClick={handleOnClick}>Train Model and Push Weights</div>
        </div>
  )
}

export default PutData