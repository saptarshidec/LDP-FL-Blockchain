import React from 'react'

const GetAccuracy = (props) => {

    const setTextData=props.setTextData;
    const PORT=process.env.REACT_APP_BACKEND_PORT | process.env.PORT+2000;

    const handleOnClick = async(e) => {
        e.preventDefault();
        try{
            const result=await fetch(`http://localhost:${PORT}/getaccuracy`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                },
            });
            const data=await result.json();
            console.log(data);
            setTextData(data.message);
        }
        catch(err){
            console.log(err);
            setTextData(err);
        }
    }
    
    return ( 
        <div className='m-3'>
            <div className="btn btn-primary mt-1 mx-3" onClick={handleOnClick}>Get Current Model Accuracy</div>
        </div>
    )
}

export default GetAccuracy